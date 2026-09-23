import {Injectable, Logger} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {DataSource, LessThanOrEqual, Repository} from "typeorm";

import {envBool, envInt} from "../config/env";
import * as time from "../common/time";
import {newId} from "../common/util";
import {isUniqueViolation} from "../database/db-errors";
import {RecurringOccurrence} from "../database/entities/recurring-occurrence.entity";
import {RecurringRule} from "../database/entities/recurring-rule.entity";
import {Transaction} from "../database/entities/transaction.entity";

export const FREQ_DAILY = 0;
export const FREQ_WEEKLY = 1;
export const FREQ_MONTHLY = 2;
export const FREQ_YEARLY = 3;

export const STATUS_ACTIVE = 0;
export const STATUS_PAUSED = 1;
export const STATUS_ENDED = 2;

export const SOURCE_RECURRING = 1;

export class AlreadyMaterializedError extends Error {
    constructor() {
        super("already materialized");
    }
}

/** Advance a rule's `next_run_at`, mirroring the loco.rs implementation. */
export function nextOccurrence(from: Date, rule: RecurringRule): Date {
    const interval = Math.max(rule.interval, 1);
    switch (rule.frequency) {
        case FREQ_WEEKLY: {
            const target = rule.day_of_week ?? from.getUTCDay();
            const candidate = time.addDays(from, interval * 7);
            const current = candidate.getUTCDay();
            const delta = (((target - current) % 7) + 7) % 7;
            return time.addDays(candidate, delta);
        }
        case FREQ_MONTHLY: {
            const date = time.addMonthsClamped(from, interval);
            const requested = rule.day_of_month ?? from.getUTCDate();
            const lastDay = time.endOfMonth(date).getUTCDate();
            const day = Math.min(Math.max(requested, 1), lastDay);
            return time.withYmd(from, date.getUTCFullYear(), date.getUTCMonth() + 1, day);
        }
        case FREQ_YEARLY: {
            const year = from.getUTCFullYear() + interval;
            const month = rule.month_of_year ?? from.getUTCMonth() + 1;
            const lastDay = time.endOfMonth(time.parseDate(`${year}-${String(month).padStart(2, "0")}-01`)!).getUTCDate();
            const requested = rule.day_of_month ?? from.getUTCDate();
            const day = Math.min(requested, lastDay);
            return time.withYmd(from, year, month, day);
        }
        case FREQ_DAILY:
        default:
            return time.addDays(from, interval);
    }
}

/**
 * Request-time catch-up (no background worker): called for every authenticated
 * request before the handler runs.
 */
@Injectable()
export class RecurringService {
    private readonly logger = new Logger(RecurringService.name);

    constructor(
        @InjectRepository(RecurringRule) private readonly rules: Repository<RecurringRule>,
        @InjectRepository(RecurringOccurrence)
        private readonly occurrences: Repository<RecurringOccurrence>,
        @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
        private readonly dataSource: DataSource
    ) {}

    async catchUp(userId: string): Promise<void> {
        const now = time.toDbDatetime(time.nowLocal());
        let rules: RecurringRule[];
        try {
            rules = await this.rules.find({
                where: {user_id: userId, status: STATUS_ACTIVE, next_run_at: LessThanOrEqual(now)},
                order: {next_run_at: "ASC"},
            });
        } catch (error) {
            this.logger.warn(`recurring catch-up query failed: ${String(error)}`);
            return;
        }

        for (const rule of rules) {
            try {
                await this.processRule(userId, rule);
            } catch (error) {
                this.logger.warn(`recurring catch-up failed for rule ${rule.id}: ${String(error)}`);
            }
        }
    }

    private backfillEnabled(): boolean {
        return envBool("RECURRING_BACKFILL_ENABLED", false);
    }

    private backfillLimit(): number {
        return Math.max(envInt("RECURRING_BACKFILL_MAX_DAYS", 90), 1);
    }

    private async processRule(userId: string, rule: RecurringRule): Promise<void> {
        const nowDate = time.nowLocal();
        const now = time.toDbDatetime(nowDate);
        const backfill = this.backfillEnabled();
        const cutoff = time.addDays(nowDate, -this.backfillLimit());

        const due: Date[] = [];
        let cursor = time.fromDbDatetime(rule.next_run_at);
        const endOn = rule.end_on ? time.fromDbDate(rule.end_on) : null;

        while (time.compare(cursor, nowDate) <= 0) {
            if (endOn && time.compare(time.beginningOfDay(cursor), time.beginningOfDay(endOn)) > 0) {
                break;
            }
            due.push(cursor);
            cursor = nextOccurrence(cursor, rule);
            if (backfill && time.compare(time.beginningOfDay(cursor), time.beginningOfDay(cutoff)) < 0) {
                break;
            }
        }

        if (due.length === 0) {
            return;
        }

        let occurrences = due;
        if (backfill) {
            const skipped = due.filter(runAt => time.compare(time.beginningOfDay(runAt), time.beginningOfDay(cutoff)) < 0).length;
            if (skipped > 0) {
                this.logger.warn(`recurring backfill limit reached for rule ${rule.id}, skipped ${skipped}`);
            }
            occurrences = due.filter(runAt => time.compare(time.beginningOfDay(runAt), time.beginningOfDay(cutoff)) >= 0);
        }

        // Without backfill only the most recent due occurrence is materialized;
        // every occurrence is still recorded in `recurring_occurrences`.
        const firstMaterialized = backfill ? 0 : Math.max(occurrences.length - 1, 0);
        for (let index = 0; index < occurrences.length; index += 1) {
            await this.recordOccurrence(userId, rule, occurrences[index], index >= firstMaterialized, now);
        }

        const nextRunAt = time.toDbDatetime(cursor);
        const data: Partial<RecurringRule> = {
            last_run_at: now,
            next_run_at: nextRunAt,
            updated_at: now,
        };
        if (endOn && time.compare(time.beginningOfDay(cursor), time.beginningOfDay(endOn)) > 0) {
            data.status = STATUS_ENDED;
        }
        await this.rules.update({id: rule.id}, data);
    }

    private baseTransactionData(userId: string, rule: RecurringRule, occurredAt: Date, now: string): Transaction {
        return {
            id: newId(),
            user_id: userId,
            account_id: rule.account_id,
            category_id: rule.category_id,
            merchant_id: rule.merchant_id,
            kind: rule.kind,
            amount_cents: rule.amount_cents,
            currency: rule.currency,
            occurred_at: time.toDbDatetime(occurredAt),
            note: rule.note,
            payment_method: null,
            image_urls: "[]",
            source: SOURCE_RECURRING,
            transfer_account_id: null,
            idempotency_key: null,
            created_at: now,
            updated_at: now,
        };
    }

    private async recordOccurrence(userId: string, rule: RecurringRule, runAt: Date, materialize: boolean, now: string): Promise<void> {
        const occurredOn = time.toDbDate(runAt);
        const existing = await this.occurrences.findOne({
            where: {recurring_rule_id: rule.id, occurred_on: occurredOn},
        });
        if (existing) {
            return;
        }

        const occurrenceId = newId();
        try {
            await this.occurrences.insert({
                id: occurrenceId,
                recurring_rule_id: rule.id,
                occurred_on: occurredOn,
                transaction_id: null,
                created_at: now,
                updated_at: now,
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                // A concurrent request recorded this occurrence first; it owns the
                // materialization, so treat the race as already processed.
                return;
            }
            throw error;
        }

        if (!materialize) {
            return;
        }

        const transaction = await this.transactions.save(this.baseTransactionData(userId, rule, runAt, now));

        await this.occurrences.update({id: occurrenceId}, {transaction_id: transaction.id, updated_at: now});
    }

    /** Manual `run_now`: build a transaction for today's occurrence unless done. */
    async runNow(userId: string, rule: RecurringRule): Promise<Transaction> {
        const nowDate = time.nowLocal();
        const now = time.toDbDatetime(nowDate);
        const today = time.toDbDate(nowDate);

        return this.dataSource.transaction(async manager => {
            const occurrence = await manager.findOne(RecurringOccurrence, {
                where: {recurring_rule_id: rule.id, occurred_on: today},
            });

            if (occurrence && occurrence.transaction_id !== null) {
                throw new AlreadyMaterializedError();
            }

            const occurrenceId = occurrence?.id ?? newId();
            if (!occurrence) {
                await manager.insert(RecurringOccurrence, {
                    id: occurrenceId,
                    recurring_rule_id: rule.id,
                    occurred_on: today,
                    transaction_id: null,
                    created_at: now,
                    updated_at: now,
                });
            }

            const transaction = await manager.save(Transaction, this.baseTransactionData(userId, rule, nowDate, now));

            await manager.update(RecurringOccurrence, {id: occurrenceId}, {transaction_id: transaction.id, updated_at: now});

            return transaction;
        });
    }

    /** `skip_next`: record the next occurrence without a transaction. */
    async skipNext(rule: RecurringRule): Promise<RecurringRule> {
        const now = time.toDbDatetime(time.nowLocal());
        const nextDate = time.toDbDate(time.fromDbDatetime(rule.next_run_at));

        const existing = await this.occurrences.findOne({
            where: {recurring_rule_id: rule.id, occurred_on: nextDate},
        });

        if (existing) {
            await this.occurrences.update({id: existing.id}, {transaction_id: null, updated_at: now});
        } else {
            await this.occurrences.insert({
                id: newId(),
                recurring_rule_id: rule.id,
                occurred_on: nextDate,
                transaction_id: null,
                created_at: now,
                updated_at: now,
            });
        }

        await this.rules.update(
            {id: rule.id},
            {
                last_run_at: now,
                next_run_at: time.toDbDatetime(nextOccurrence(time.fromDbDatetime(rule.next_run_at), rule)),
                updated_at: now,
            }
        );
        return this.rules.findOneByOrFail({id: rule.id});
    }
}
