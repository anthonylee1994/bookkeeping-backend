import {beforeEach, describe, expect, it, vi} from "vitest";

import {DashboardController} from "../src/dashboard/dashboard.controller";
import {RecurringRule} from "../src/database/entities/recurring-rule.entity";
import {Transaction} from "../src/database/entities/transaction.entity";
import {ReportingService} from "../src/reports/reporting.service";
import {MockRepo, mockRepo, repo, ruleFixture, transactionFixture, userFixture} from "./helpers/unit";

const USER = "user-1";

describe("DashboardController (unit)", () => {
    let transactions: MockRepo;
    let rules: MockRepo;
    let reporting: {loadCategoryNames: ReturnType<typeof vi.fn>; accountBalances: ReturnType<typeof vi.fn>};
    let controller: DashboardController;

    beforeEach(() => {
        transactions = mockRepo();
        rules = mockRepo();
        reporting = {loadCategoryNames: vi.fn().mockResolvedValue(new Map()), accountBalances: vi.fn().mockResolvedValue([])};
        controller = new DashboardController(repo<Transaction>(transactions), repo<RecurringRule>(rules), reporting as unknown as ReportingService);
    });

    it("rejects an invalid date", async () => {
        await expect(controller.show(userFixture({id: USER}), "not-a-date")).rejects.toMatchObject({status: 422});
    });

    it("aggregates the month, recent rows and reminders", async () => {
        transactions.find
            .mockResolvedValueOnce([
                transactionFixture({kind: 0, amount_cents: 10_000}),
                transactionFixture({kind: 1, amount_cents: 3_000, category_id: "c1"}),
                transactionFixture({kind: 2, amount_cents: 5_000}),
            ])
            .mockResolvedValueOnce([transactionFixture({id: "recent"})]);
        reporting.loadCategoryNames.mockResolvedValue(new Map([["c1", "飲食"]]));
        reporting.accountBalances.mockResolvedValue([{id: "a1", name: "現金", currency: "HKD", initial_balance_cents: 0, balance_cents: 7_000}]);
        rules.find.mockResolvedValue([ruleFixture({id: "r1"}), ruleFixture({id: "r2"})]);

        const result = (await controller.show(userFixture({id: USER}), "2026-09-14")) as {data: Record<string, unknown>};

        expect(result.data).toMatchObject({income_cents: 10_000, expense_cents: 3_000, net_cents: 7_000});
        expect(result.data.range).toEqual({from: "2026-09-01T00:00:00+08:00", to: "2026-09-30T23:59:59+08:00"});
        expect((result.data.recent_transactions as unknown[]).length).toBe(1);
        expect((result.data.upcoming_recurring as unknown[]).length).toBe(2);
        expect(result.data.recurring_reminders).toEqual(result.data.upcoming_recurring);
        expect(result.data.accounts).toEqual(result.data.account_balances);

        const firstArgs = transactions.find.mock.calls[0]?.[0] as {where: Record<string, unknown>};
        expect(firstArgs.where).toMatchObject({user_id: USER, occurred_at: expect.anything()});
        expect(rules.find).toHaveBeenCalledWith(expect.objectContaining({where: expect.objectContaining({user_id: USER, status: 0})}));
    });
});
