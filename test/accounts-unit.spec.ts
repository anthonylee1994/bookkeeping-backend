import {beforeEach, describe, expect, it} from "vitest";

import {AccountsController} from "../src/accounts/accounts.controller";
import {ApiError} from "../src/common/errors";
import {Account} from "../src/database/entities/account.entity";
import {RecurringRule} from "../src/database/entities/recurring-rule.entity";
import {Transaction} from "../src/database/entities/transaction.entity";
import {accountFixture, MockRepo, mockRepo, repo, ruleFixture, transactionFixture, userFixture} from "./helpers/unit";

const USER = "user-1";

function uniqueViolation(): unknown {
    return {driverError: {code: "SQLITE_CONSTRAINT_UNIQUE"}};
}

describe("AccountsController (unit)", () => {
    let accounts: MockRepo;
    let transactions: MockRepo;
    let rules: MockRepo;
    let controller: AccountsController;

    beforeEach(() => {
        accounts = mockRepo();
        transactions = mockRepo();
        rules = mockRepo();
        controller = new AccountsController(repo<Account>(accounts), repo<Transaction>(transactions), repo<RecurringRule>(rules));
    });

    it("index returns serialized accounts scoped to the user", async () => {
        accounts.find.mockResolvedValue([accountFixture({id: "a1", name: "現金", kind: 0})]);

        const result = (await controller.index(userFixture({id: USER}))) as {data: Array<Record<string, unknown>>};

        expect(accounts.find).toHaveBeenCalledWith({where: {user_id: USER}, order: {created_at: "ASC"}});
        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toMatchObject({id: "a1", name: "現金", kind: "cash"});
    });

    it("create rejects a blank name", async () => {
        await expect(controller.create(userFixture({id: USER}), {name: "   ", kind: "cash"})).rejects.toMatchObject({status: 422, details: {name: ["不可為空白"]}});
    });

    it("create rejects a missing kind", async () => {
        await expect(controller.create(userFixture({id: USER}), {name: "Bank"})).rejects.toMatchObject({status: 422, details: {kind: ["不可為空白"]}});
    });

    it("create rejects a duplicate name", async () => {
        accounts.findOne.mockResolvedValue(accountFixture());

        await expect(controller.create(userFixture({id: USER}), {name: "現金", kind: "cash"})).rejects.toMatchObject({status: 422, details: {name: ["已被使用"]}});
    });

    it("create trims the name, defaults the currency and returns the payload", async () => {
        const result = (await controller.create(userFixture({id: USER}), {name: "  Bank  ", kind: "bank", initial_balance_cents: 500})) as {data: Record<string, unknown>};

        const saved = accounts.save.mock.calls[0]?.[0] as Account;
        expect(saved.name).toBe("Bank");
        expect(saved.kind).toBe(1);
        expect(saved.currency).toBe("HKD");
        expect(saved.initial_balance_cents).toBe(500);
        expect(saved.user_id).toBe(USER);
        expect(result.data).toMatchObject({name: "Bank", kind: "bank"});
    });

    it("create maps a unique violation to a name-taken error", async () => {
        accounts.save.mockRejectedValue(uniqueViolation());

        await expect(controller.create(userFixture({id: USER}), {name: "現金", kind: "cash"})).rejects.toMatchObject({status: 422, details: {name: ["已被使用"]}});
    });

    it("update 404s when the account is out of scope", async () => {
        accounts.findOne.mockResolvedValue(null);
        await expect(controller.update(userFixture({id: USER}), "missing", {name: "x"})).rejects.toMatchObject({status: 404});
    });

    it("update rejects renaming to a blank name", async () => {
        accounts.findOne.mockResolvedValueOnce(accountFixture());
        await expect(controller.update(userFixture({id: USER}), "a1", {name: "  "})).rejects.toMatchObject({status: 422, details: {name: ["不可為空白"]}});
    });

    it("update rejects a name that collides with another account", async () => {
        accounts.findOne.mockResolvedValueOnce(accountFixture({id: "a1"})).mockResolvedValueOnce(accountFixture({id: "a2"}));
        await expect(controller.update(userFixture({id: USER}), "a1", {name: "現金"})).rejects.toMatchObject({status: 422, details: {name: ["已被使用"]}});
    });

    it("update applies the provided fields", async () => {
        accounts.findOne.mockResolvedValueOnce(accountFixture({id: "a1", name: "現金", kind: 0})).mockResolvedValueOnce(null);

        const result = (await controller.update(userFixture({id: USER}), "a1", {name: "Cash", kind: "e_wallet"})) as {data: Record<string, unknown>};

        const saved = accounts.save.mock.calls[0]?.[0] as Account;
        expect(saved.name).toBe("Cash");
        expect(saved.kind).toBe(3);
        expect(result.data).toMatchObject({name: "Cash", kind: "e_wallet"});
    });

    it("destroy 404s when the account is out of scope", async () => {
        accounts.findOne.mockResolvedValue(null);
        await expect(controller.destroy(userFixture({id: USER}), "missing")).rejects.toMatchObject({status: 404});
    });

    it("destroy refuses an account used by a transaction", async () => {
        accounts.findOne.mockResolvedValue(accountFixture({id: "a1"}));
        transactions.findOne.mockResolvedValueOnce(transactionFixture());

        await expect(controller.destroy(userFixture({id: USER}), "a1")).rejects.toMatchObject({status: 422, code: "account_in_use"});
        expect(accounts.delete).not.toHaveBeenCalled();
    });

    it("destroy refuses an account used by a recurring rule", async () => {
        accounts.findOne.mockResolvedValue(accountFixture({id: "a1"}));
        rules.findOne.mockResolvedValue(ruleFixture());

        await expect(controller.destroy(userFixture({id: USER}), "a1")).rejects.toMatchObject({code: "account_in_use"});
    });

    it("destroy removes an unused account", async () => {
        accounts.findOne.mockResolvedValue(accountFixture({id: "a1"}));

        await expect(controller.destroy(userFixture({id: USER}), "a1")).resolves.toBeUndefined();
        expect(accounts.delete).toHaveBeenCalledWith({id: "a1"});
    });

    it("rejects an unknown account kind", async () => {
        await expect(controller.create(userFixture({id: USER}), {name: "Bank", kind: "crypto"})).rejects.toBeInstanceOf(ApiError);
    });
});
