import {beforeEach, describe, expect, it, vi} from "vitest";

import {SummariesController} from "../src/summaries/summaries.controller";
import {Transaction} from "../src/database/entities/transaction.entity";
import {ReportingService} from "../src/reports/reporting.service";
import {MockRepo, mockRepo, repo, transactionFixture, userFixture} from "./helpers/unit";

const USER = "user-1";

describe("SummariesController (unit)", () => {
    let transactions: MockRepo;
    let reporting: {loadCategoryNames: ReturnType<typeof vi.fn>; loadAccountNames: ReturnType<typeof vi.fn>};
    let controller: SummariesController;

    beforeEach(() => {
        transactions = mockRepo();
        reporting = {loadCategoryNames: vi.fn().mockResolvedValue(new Map()), loadAccountNames: vi.fn().mockResolvedValue(new Map())};
        controller = new SummariesController(repo<Transaction>(transactions), reporting as unknown as ReportingService);
    });

    it("rejects an invalid date", async () => {
        await expect(controller.daily(userFixture({id: USER}), "nope")).rejects.toMatchObject({status: 422});
    });

    it("daily totals exclude transfers and split by account", async () => {
        transactions.find.mockResolvedValue([
            transactionFixture({account_id: "a1", kind: 0, amount_cents: 10_000, occurred_at: "2026-09-14 10:00:00.000"}),
            transactionFixture({account_id: "a1", kind: 1, amount_cents: 3_000, category_id: "c1", occurred_at: "2026-09-14 11:00:00.000"}),
            transactionFixture({account_id: "a1", kind: 2, amount_cents: 5_000, transfer_account_id: "a2", occurred_at: "2026-09-14 12:00:00.000"}),
        ]);
        reporting.loadCategoryNames.mockResolvedValue(new Map([["c1", "飲食"]]));
        reporting.loadAccountNames.mockResolvedValue(new Map([["a1", "現金"]]));

        const result = (await controller.daily(userFixture({id: USER}), "2026-09-14")) as {data: Record<string, unknown>};

        expect(result.data).toMatchObject({income_cents: 10_000, expense_cents: 3_000, net_cents: 7_000});
        expect(result.data.transfers).toEqual({count: 1, total_cents: 5_000});
        expect(result.data.by_category).toEqual([
            {category_id: "c1", name: "飲食", income_cents: 0, expense_cents: 3_000},
            {category_id: null, name: null, income_cents: 10_000, expense_cents: 0},
        ]);
        expect(result.data.by_account).toEqual([{account_id: "a1", name: "現金", income_cents: 10_000, expense_cents: 3_000}]);
        expect(result.data.range).toEqual({from: "2026-09-14T00:00:00+08:00", to: "2026-09-14T23:59:59+08:00"});
    });

    it("weekly uses monday-to-sunday boundaries", async () => {
        // 2026-09-16 is a Wednesday.
        const result = (await controller.weekly(userFixture({id: USER}), "2026-09-16")) as {data: Record<string, unknown>};
        expect(result.data.range).toEqual({from: "2026-09-14T00:00:00+08:00", to: "2026-09-20T23:59:59+08:00"});
    });

    it("monthly uses month boundaries and returns a daily breakdown", async () => {
        transactions.find.mockResolvedValue([
            transactionFixture({kind: 0, amount_cents: 1_000, occurred_at: "2026-09-01 10:00:00.000"}),
            transactionFixture({kind: 1, amount_cents: 400, occurred_at: "2026-09-01 11:00:00.000"}),
            transactionFixture({kind: 0, amount_cents: 2_000, occurred_at: "2026-09-03 09:00:00.000"}),
        ]);

        const result = (await controller.monthly(userFixture({id: USER}), "2026-09-14")) as {data: Record<string, unknown>};

        expect(result.data.range).toEqual({from: "2026-09-01T00:00:00+08:00", to: "2026-09-30T23:59:59+08:00"});
        expect(result.data.daily).toEqual([
            {date: "2026-09-01", net_cents: 600},
            {date: "2026-09-03", net_cents: 2_000},
        ]);
    });

    it("paginates the transaction list newest first", async () => {
        transactions.find.mockResolvedValue([
            transactionFixture({id: "t1", kind: 1, amount_cents: 1_000, occurred_at: "2026-09-14 10:00:00.000"}),
            transactionFixture({id: "t2", kind: 1, amount_cents: 2_000, occurred_at: "2026-09-14 11:00:00.000"}),
            transactionFixture({id: "t3", kind: 1, amount_cents: 3_000, occurred_at: "2026-09-14 12:00:00.000"}),
        ]);

        const result = (await controller.daily(userFixture({id: USER}), "2026-09-14", "2", "2")) as {data: Record<string, unknown>};
        const page = result.data.transactions as {data: Array<Record<string, unknown>>; meta: Record<string, number>};

        expect(page.meta).toEqual({page: 2, per_page: 2, total: 3, total_pages: 2});
        expect(page.data).toHaveLength(1);
        expect(page.data[0].id).toBe("t1");
    });
});
