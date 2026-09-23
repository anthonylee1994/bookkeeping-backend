import {beforeEach, describe, expect, it, vi} from "vitest";
import type {DataSource, Repository} from "typeorm";

import * as time from "../src/common/time";
import {Account} from "../src/database/entities/account.entity";
import {Category} from "../src/database/entities/category.entity";
import {Merchant} from "../src/database/entities/merchant.entity";
import type {RecurringOccurrence} from "../src/database/entities/recurring-occurrence.entity";
import {RecurringOccurrence as RecurringOccurrenceEntity} from "../src/database/entities/recurring-occurrence.entity";
import type {RecurringRule} from "../src/database/entities/recurring-rule.entity";
import {RecurringRule as RecurringRuleEntity} from "../src/database/entities/recurring-rule.entity";
import {Transaction} from "../src/database/entities/transaction.entity";
import {RecurringController} from "../src/recurring/recurring.controller";
import {AlreadyMaterializedError, FREQ_DAILY, FREQ_MONTHLY, FREQ_WEEKLY, FREQ_YEARLY, nextOccurrence, RecurringService, STATUS_ACTIVE, STATUS_PAUSED} from "../src/recurring/recurring.service";
import {accountFixture, categoryFixture, dataSource, MockDataSource, MockRepo, mockDataSource, mockRepo, repo, ruleFixture, transactionFixture, userFixture} from "./helpers/unit";

function rule(frequency: number, interval: number, dayOfWeek: number | null, dayOfMonth: number | null, monthOfYear: number | null): RecurringRule {
    const start = time.parseDate("2026-01-01")!;
    return {
        id: "rule",
        user_id: "user",
        account_id: "account",
        category_id: null,
        merchant_id: null,
        kind: 1,
        amount_cents: 1000,
        currency: "HKD",
        frequency,
        interval,
        day_of_week: dayOfWeek,
        day_of_month: dayOfMonth,
        month_of_year: monthOfYear,
        start_on: time.toDbDate(start),
        end_on: null,
        next_run_at: time.toDbDatetime(time.beginningOfDay(start)),
        last_run_at: null,
        status: STATUS_ACTIVE,
        note: null,
        created_at: time.toDbDatetime(time.beginningOfDay(start)),
        updated_at: time.toDbDatetime(time.beginningOfDay(start)),
    };
}

function at(year: number, month: number, day: number, hour: number): Date {
    return time.parseDatetime(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00`)!;
}

describe("nextOccurrence", () => {
    it("clamps monthly day 31 to the last day of February", () => {
        const next = nextOccurrence(at(2026, 1, 31, 9), rule(FREQ_MONTHLY, 1, null, 31, null));
        expect(time.toDbDate(next)).toBe("2026-02-28");
    });

    it("respects the daily interval", () => {
        const next = nextOccurrence(at(2026, 1, 1, 0), rule(FREQ_DAILY, 2, null, null, null));
        expect(time.toDbDate(next)).toBe("2026-01-03");
    });

    it("clamps yearly day 29 in a non-leap year", () => {
        const next = nextOccurrence(at(2026, 2, 28, 0), rule(FREQ_YEARLY, 1, null, 29, 2));
        expect(time.toDbDate(next)).toBe("2027-02-28");
    });

    it("keeps the configured weekday for weekly rules", () => {
        // 2026-09-14 is a Monday; the next weekly occurrence is the next Monday.
        const next = nextOccurrence(at(2026, 9, 14, 10), rule(FREQ_WEEKLY, 1, 1, null, null));
        expect(time.toDbDate(next)).toBe("2026-09-21");
    });

    it("defaults monthly to the current day of month", () => {
        const next = nextOccurrence(at(2026, 1, 15, 8), rule(FREQ_MONTHLY, 1, null, null, null));
        expect(time.toDbDate(next)).toBe("2026-02-15");
    });
});

describe("RecurringService.catchUp", () => {
    it("rescues a concurrent occurrence unique collision instead of aborting", async () => {
        const due = rule(FREQ_DAILY, 1, null, null, null);
        due.next_run_at = time.toDbDatetime(time.nowLocal());

        const occurrencesInsert = vi.fn().mockRejectedValue({code: "SQLITE_CONSTRAINT_UNIQUE"});
        const occurrencesFindOne = vi.fn().mockResolvedValue(null);
        const transactionsSave = vi.fn();
        const rulesUpdate = vi.fn().mockResolvedValue({affected: 1});
        const rulesFind = vi.fn().mockResolvedValue([due]);
        const service = new RecurringService(
            {find: rulesFind, update: rulesUpdate} as unknown as Repository<RecurringRule>,
            {
                findOne: occurrencesFindOne,
                insert: occurrencesInsert,
            } as unknown as Repository<RecurringOccurrence>,
            {save: transactionsSave} as unknown as Repository<Transaction>,
            {} as unknown as DataSource
        );

        await expect(service.catchUp("user")).resolves.toBeUndefined();

        expect(occurrencesInsert).toHaveBeenCalledTimes(1);
        // The losing request must not materialize a duplicate transaction.
        expect(transactionsSave).not.toHaveBeenCalled();
        // The rule still advances so it is not retried on every request.
        expect(rulesUpdate).toHaveBeenCalledTimes(1);
    });
});

describe("RecurringController (unit)", () => {
    let rules: MockRepo;
    let accounts: MockRepo;
    let categories: MockRepo;
    let merchants: MockRepo;
    let ds: MockDataSource;
    let recurring: {runNow: ReturnType<typeof vi.fn>; skipNext: ReturnType<typeof vi.fn>};
    let controller: RecurringController;

    const user = () => userFixture({id: "user-1"});

    beforeEach(() => {
        rules = mockRepo();
        accounts = mockRepo();
        categories = mockRepo();
        merchants = mockRepo();
        ds = mockDataSource();
        recurring = {runNow: vi.fn(), skipNext: vi.fn()};
        controller = new RecurringController(
            repo<RecurringRule>(rules),
            repo<Account>(accounts),
            repo<Category>(categories),
            repo<Merchant>(merchants),
            dataSource(ds),
            recurring as unknown as RecurringService
        );
    });

    it("index short-circuits an unknown status", async () => {
        await expect(controller.index(user(), "nonsense")).resolves.toEqual({data: []});
        expect(rules.find).not.toHaveBeenCalled();
    });

    it("index filters by status", async () => {
        await controller.index(user(), "paused");
        expect(rules.find).toHaveBeenCalledWith({where: {user_id: "user-1", status: STATUS_PAUSED}, order: {created_at: "ASC"}});
    });

    it("create requires start_on", async () => {
        await expect(controller.create(user(), {account_id: "a1", kind: "expense", amount_cents: 1000, frequency: "daily"})).rejects.toMatchObject({details: {start_on: ["不可為空白"]}});
    });

    it("create rejects an unparseable start_on", async () => {
        await expect(controller.create(user(), {account_id: "a1", kind: "expense", amount_cents: 1000, frequency: "daily", start_on: "nope"})).rejects.toMatchObject({status: 422});
    });

    it("create rejects a non-positive amount", async () => {
        accounts.findOne.mockResolvedValue(accountFixture({id: "a1"}));
        await expect(controller.create(user(), {account_id: "a1", kind: "expense", amount_cents: 0, frequency: "daily", start_on: "2026-09-01"})).rejects.toMatchObject({
            details: {amount_cents: ["必須大於 0"]},
        });
    });

    it("create validates field ranges", async () => {
        accounts.findOne.mockResolvedValue(accountFixture({id: "a1"}));
        const base = {account_id: "a1", kind: "expense", amount_cents: 1000, frequency: "weekly", start_on: "2026-09-01"};

        await expect(controller.create(user(), {...base, interval: 0})).rejects.toMatchObject({details: {interval: ["必須大於 0"]}});
        await expect(controller.create(user(), {...base, day_of_week: 7})).rejects.toMatchObject({details: {day_of_week: ["不在允許的範圍內"]}});
        await expect(controller.create(user(), {...base, day_of_month: 0})).rejects.toMatchObject({details: {day_of_month: ["不在允許的範圍內"]}});
        await expect(controller.create(user(), {...base, month_of_year: 13})).rejects.toMatchObject({details: {month_of_year: ["不在允許的範圍內"]}});
    });

    it("create rejects an account the user does not own", async () => {
        accounts.findOne.mockResolvedValue(null);
        await expect(controller.create(user(), {account_id: "a1", kind: "expense", amount_cents: 1000, frequency: "daily", start_on: "2026-09-01"})).rejects.toMatchObject({
            details: {account: ["無效"]},
        });
    });

    it("create defaults next_run_at to the start of the start date", async () => {
        accounts.findOne.mockResolvedValue(accountFixture({id: "a1"}));

        const result = (await controller.create(user(), {account_id: "a1", kind: "expense", amount_cents: 1000, frequency: "monthly", start_on: "2026-09-01"})) as {data: Record<string, unknown>};

        const saved = rules.save.mock.calls[0]?.[0] as RecurringRule;
        expect(saved.next_run_at).toBe("2026-09-01 00:00:00.000");
        expect(saved).toMatchObject({user_id: "user-1", frequency: FREQ_MONTHLY, interval: 1, status: STATUS_ACTIVE});
        expect(result.data).toMatchObject({frequency: "monthly", status: "active"});
    });

    it("create rejects an invalid enum value", async () => {
        await expect(controller.create(user(), {account_id: "a1", kind: "expense", amount_cents: 1000, frequency: "hourly", start_on: "2026-09-01"})).rejects.toMatchObject({
            status: 422,
        });
    });

    it("destroy removes occurrences and the rule in one transaction", async () => {
        rules.findOne.mockResolvedValue(ruleFixture({id: "r1"}));

        await controller.destroy(user(), "r1");

        expect(ds.manager.delete).toHaveBeenNthCalledWith(1, RecurringOccurrenceEntity, {recurring_rule_id: "r1"});
        expect(ds.manager.delete).toHaveBeenNthCalledWith(2, RecurringRuleEntity, {id: "r1"});
    });

    it("pause flips the status", async () => {
        rules.findOne.mockResolvedValue(ruleFixture({id: "r1"}));
        rules.findOneByOrFail.mockResolvedValue(ruleFixture({id: "r1", status: STATUS_PAUSED}));

        const result = (await controller.pause(user(), "r1")) as {data: Record<string, unknown>};

        expect(rules.update).toHaveBeenCalledWith({id: "r1"}, expect.objectContaining({status: STATUS_PAUSED}));
        expect(result.data.status).toBe("paused");
    });

    it("resume re-anchors a stale next_run_at to now", async () => {
        rules.findOne.mockResolvedValue(ruleFixture({id: "r1", status: STATUS_PAUSED, next_run_at: "2000-01-01 00:00:00.000"}));
        rules.findOneByOrFail.mockResolvedValue(ruleFixture({id: "r1", status: STATUS_ACTIVE}));

        await controller.resume(user(), "r1");

        const data = rules.update.mock.calls[0]?.[1] as {status: number; next_run_at: string};
        expect(data.status).toBe(STATUS_ACTIVE);
        expect(data.next_run_at >= time.toDbDatetime(time.nowLocal())).toBe(true);
    });

    it("resume keeps a future next_run_at", async () => {
        const future = time.toDbDatetime(time.addDays(time.nowLocal(), 5));
        rules.findOne.mockResolvedValue(ruleFixture({id: "r1", status: STATUS_PAUSED, next_run_at: future}));
        rules.findOneByOrFail.mockResolvedValue(ruleFixture({id: "r1"}));

        await controller.resume(user(), "r1");

        expect(rules.update).toHaveBeenCalledWith({id: "r1"}, expect.objectContaining({next_run_at: future}));
    });

    it("runNow reports an already materialized occurrence", async () => {
        rules.findOne.mockResolvedValue(ruleFixture({id: "r1"}));
        recurring.runNow.mockRejectedValue(new AlreadyMaterializedError());

        await expect(controller.runNow(user(), "r1")).rejects.toMatchObject({status: 409, code: "already_materialized"});
    });

    it("runNow returns the created transaction", async () => {
        rules.findOne.mockResolvedValue(ruleFixture({id: "r1"}));
        recurring.runNow.mockResolvedValue(transactionFixture({id: "t1", kind: 1, source: 1}));

        const result = (await controller.runNow(user(), "r1")) as {data: Record<string, unknown>};

        expect(result.data).toMatchObject({id: "t1", source: "recurring", net_amount_cents: 1000});
    });

    it("skipNext advances through the service", async () => {
        rules.findOne.mockResolvedValue(ruleFixture({id: "r1"}));
        recurring.skipNext.mockResolvedValue(ruleFixture({id: "r1", note: "skipped"}));

        const result = (await controller.skipNext(user(), "r1")) as {data: Record<string, unknown>};

        expect(recurring.skipNext).toHaveBeenCalledTimes(1);
        expect(result.data).toMatchObject({id: "r1", note: "skipped"});
    });

    it("update rejects a non-positive amount", async () => {
        rules.findOne.mockResolvedValue(ruleFixture({id: "r1"}));
        accounts.findOne.mockResolvedValue(accountFixture({id: "account-1"}));

        await expect(controller.update(user(), "r1", {amount_cents: -5})).rejects.toMatchObject({details: {amount_cents: ["必須大於 0"]}});
    });

    it("update clears a touched category", async () => {
        rules.findOne.mockResolvedValue(ruleFixture({id: "r1", category_id: "c1"}));
        accounts.findOne.mockResolvedValue(accountFixture({id: "account-1"}));
        categories.findOne.mockResolvedValue(categoryFixture({id: "c1"}));

        await controller.update(user(), "r1", {category_id: null});

        const saved = rules.save.mock.calls[0]?.[0] as RecurringRule;
        expect(saved.category_id).toBeNull();
    });

    it("update 404s when the rule is out of scope", async () => {
        rules.findOne.mockResolvedValue(null);
        await expect(controller.update(user(), "missing", {amount_cents: 1})).rejects.toMatchObject({status: 404});
    });
});

describe("RecurringService run_now / skip_next (unit)", () => {
    let rules: MockRepo;
    let occurrences: MockRepo;
    let transactions: MockRepo;
    let ds: MockDataSource;
    let service: RecurringService;

    beforeEach(() => {
        rules = mockRepo();
        occurrences = mockRepo();
        transactions = mockRepo();
        ds = mockDataSource();
        service = new RecurringService(repo<RecurringRule>(rules), repo<RecurringOccurrence>(occurrences), repo<Transaction>(transactions), dataSource(ds));
    });

    it("runNow refuses an already materialized occurrence", async () => {
        ds.manager.findOne.mockResolvedValue({id: "o1", transaction_id: "t1"});

        await expect(service.runNow("user-1", ruleFixture({id: "r1"}))).rejects.toBeInstanceOf(AlreadyMaterializedError);
        expect(ds.manager.save).not.toHaveBeenCalled();
    });

    it("runNow records the occurrence and materializes a transaction", async () => {
        ds.manager.findOne.mockResolvedValue(null);
        ds.manager.save.mockResolvedValue(transactionFixture({id: "t1"}));

        const transaction = await service.runNow("user-1", ruleFixture({id: "r1"}));

        expect(transaction.id).toBe("t1");
        expect(ds.manager.insert).toHaveBeenCalledTimes(1);
        expect(ds.manager.save).toHaveBeenCalledWith(Transaction, expect.objectContaining({source: 1, user_id: "user-1"}));
        expect(ds.manager.update).toHaveBeenCalledWith(RecurringOccurrenceEntity, expect.anything(), expect.objectContaining({transaction_id: "t1"}));
    });

    it("skipNext records an occurrence without a transaction and advances the rule", async () => {
        const current = ruleFixture({id: "r1", frequency: FREQ_DAILY, interval: 1, next_run_at: "2026-09-01 00:00:00.000"});
        occurrences.findOne.mockResolvedValue(null);
        rules.findOneByOrFail.mockResolvedValue(current);

        await service.skipNext(current);

        expect(occurrences.insert).toHaveBeenCalledWith(expect.objectContaining({recurring_rule_id: "r1", occurred_on: "2026-09-01", transaction_id: null}));
        expect(rules.update).toHaveBeenCalledWith({id: "r1"}, expect.objectContaining({next_run_at: "2026-09-02 00:00:00.000"}));
    });

    it("skipNext reuses an existing occurrence row", async () => {
        const current = ruleFixture({id: "r1", next_run_at: "2026-09-01 00:00:00.000"});
        occurrences.findOne.mockResolvedValue({id: "o1"});
        rules.findOneByOrFail.mockResolvedValue(current);

        await service.skipNext(current);

        expect(occurrences.insert).not.toHaveBeenCalled();
        expect(occurrences.update).toHaveBeenCalledWith({id: "o1"}, expect.objectContaining({transaction_id: null}));
    });
});
