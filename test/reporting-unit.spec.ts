import {beforeEach, describe, expect, it} from "vitest";

import {Account} from "../src/database/entities/account.entity";
import {Category} from "../src/database/entities/category.entity";
import {Transaction} from "../src/database/entities/transaction.entity";
import {ReportingService} from "../src/reports/reporting.service";
import {accountFixture, categoryFixture, MockRepo, mockRepo, repo, transactionFixture} from "./helpers/unit";

const USER = "user-1";

describe("ReportingService (unit)", () => {
    let categories: MockRepo;
    let accounts: MockRepo;
    let transactions: MockRepo;
    let service: ReportingService;

    beforeEach(() => {
        categories = mockRepo();
        accounts = mockRepo();
        transactions = mockRepo();
        service = new ReportingService(repo<Category>(categories), repo<Account>(accounts), repo<Transaction>(transactions));
    });

    it("loads category names as a map", async () => {
        categories.find.mockResolvedValue([categoryFixture({id: "c1", name: "飲食"}), categoryFixture({id: "c2", name: "交通"})]);

        const names = await service.loadCategoryNames(USER);

        expect(categories.find).toHaveBeenCalledWith({where: {user_id: USER}});
        expect(names.get("c1")).toBe("飲食");
        expect(names.get("c2")).toBe("交通");
    });

    it("loads account names as a map", async () => {
        accounts.find.mockResolvedValue([accountFixture({id: "a1", name: "現金"})]);
        const names = await service.loadAccountNames(USER);
        expect(names.get("a1")).toBe("現金");
    });

    it("computes balances from the initial balance and non-transfer totals", async () => {
        transactions.find.mockResolvedValue([
            transactionFixture({account_id: "a1", kind: 0, amount_cents: 1_000}),
            transactionFixture({account_id: "a1", kind: 1, amount_cents: 300}),
            transactionFixture({account_id: "a2", kind: 2, amount_cents: 5_000, transfer_account_id: "a1"}),
        ]);
        accounts.find.mockResolvedValue([
            accountFixture({id: "a1", name: "現金", currency: "HKD", initial_balance_cents: 500}),
            accountFixture({id: "a2", name: "銀行", currency: "HKD", initial_balance_cents: 0}),
        ]);

        const balances = await service.accountBalances(USER);

        expect(balances).toEqual([
            {id: "a1", name: "現金", currency: "HKD", initial_balance_cents: 500, balance_cents: 1_200},
            {id: "a2", name: "銀行", currency: "HKD", initial_balance_cents: 0, balance_cents: 0},
        ]);
    });
});
