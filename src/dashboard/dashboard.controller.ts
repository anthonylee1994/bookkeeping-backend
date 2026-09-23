import {Controller, Get, Query} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {Repository} from "typeorm";

import {CurrentUser} from "../auth/current-user.decorator";
import {datetimeRange} from "../common/datetime-range";
import {ApiError} from "../common/errors";
import * as time from "../common/time";
import {RecurringRule} from "../database/entities/recurring-rule.entity";
import {Transaction} from "../database/entities/transaction.entity";
import type {User} from "../database/entities/user.entity";
import {categoryTotals, sortedCategoryRows} from "../reports/reporting";
import {ReportingService} from "../reports/reporting.service";
import {rulePayload, transactionRow} from "../views/serializers";

@Controller("api/v1/dashboard")
export class DashboardController {
    constructor(
        @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
        @InjectRepository(RecurringRule) private readonly recurringRules: Repository<RecurringRule>,
        private readonly reporting: ReportingService
    ) {}

    @Get()
    async show(@CurrentUser() user: User, @Query("date") dateParam?: string): Promise<unknown> {
        let date: Date;
        if (dateParam !== undefined && dateParam !== "") {
            const parsed = time.parseDate(dateParam);
            if (!parsed) {
                throw ApiError.invalidValue();
            }
            date = parsed;
        } else {
            date = time.today();
        }

        const from = time.beginningOfDay(time.beginningOfMonth(date));
        const to = time.endOfDay(time.endOfMonth(date));

        const inRange = await this.transactions.find({
            where: {
                user_id: user.id,
                occurred_at: datetimeRange(from, to),
            },
        });

        const income = inRange.filter(tx => tx.kind === 0).reduce((sum, tx) => sum + tx.amount_cents, 0);
        const expense = inRange.filter(tx => tx.kind === 1).reduce((sum, tx) => sum + tx.amount_cents, 0);

        const recent = await this.transactions.find({
            where: {user_id: user.id},
            order: {occurred_at: "DESC"},
            take: 10,
        });

        const categoryNames = await this.reporting.loadCategoryNames(user.id);
        const byCategory = sortedCategoryRows(categoryNames, categoryTotals(inRange));

        const balances = await this.reporting.accountBalances(user.id);

        const now = time.nowLocal();
        const upcoming = await this.recurringRules.find({
            where: {
                user_id: user.id,
                status: 0,
                next_run_at: datetimeRange(now, time.addDays(now, 7)),
            },
            order: {next_run_at: "ASC"},
        });
        const reminders = upcoming.map(rulePayload);

        return {
            data: {
                range: {
                    from: time.formatDatetimeSeconds(from),
                    to: time.formatDatetimeSeconds(to),
                },
                income_cents: income,
                expense_cents: expense,
                net_cents: income - expense,
                recent_transactions: recent.map(transactionRow),
                by_category: byCategory,
                accounts: balances,
                account_balances: balances,
                upcoming_recurring: reminders,
                recurring_reminders: reminders,
            },
        };
    }
}
