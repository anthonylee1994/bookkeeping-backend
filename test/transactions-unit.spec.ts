import type {Request} from "express";
import type {RawBodyRequest} from "@nestjs/common";
import {beforeEach, describe, expect, it, vi} from "vitest";

import {ApiError} from "../src/common/errors";
import {Merchant} from "../src/database/entities/merchant.entity";
import {Transaction} from "../src/database/entities/transaction.entity";
import {TransactionsController} from "../src/transactions/transactions.controller";
import {TransactionsService} from "../src/transactions/transactions.service";
import {
    accountFixture,
    categoryFixture,
    dataSource,
    merchantFixture,
    MockDataSource,
    MockRepo,
    MockResponse,
    mockDataSource,
    mockRepo,
    mockResponse,
    repo,
    transactionFixture,
    userFixture,
} from "./helpers/unit";

const USER = "user-1";

function rawRequest(body: unknown, headers: Record<string, string> = {}): RawBodyRequest<Request> {
    return {
        rawBody: Buffer.from(JSON.stringify(body)),
        headers,
    } as unknown as RawBodyRequest<Request>;
}

describe("TransactionsController (unit)", () => {
    let transactions: MockRepo;
    let merchants: MockRepo;
    let ds: MockDataSource;
    let service: {createValidated: ReturnType<typeof vi.fn>; incrementMerchantUsage: ReturnType<typeof vi.fn>; updateValidated: ReturnType<typeof vi.fn>};
    let idempotency: {wrap: ReturnType<typeof vi.fn>};
    let controller: TransactionsController;

    beforeEach(() => {
        transactions = mockRepo();
        merchants = mockRepo();
        ds = mockDataSource();
        service = {
            createValidated: vi.fn().mockResolvedValue(transactionFixture()),
            incrementMerchantUsage: vi.fn().mockResolvedValue(undefined),
            updateValidated: vi.fn().mockResolvedValue(transactionFixture()),
        };
        idempotency = {wrap: vi.fn().mockImplementation(async (options: {run: () => Promise<unknown>}) => options.run())};
        controller = new TransactionsController(repo<Transaction>(transactions), repo<Merchant>(merchants), dataSource(ds), service as unknown as TransactionsService, idempotency as never);
    });

    it("index short-circuits an unknown kind", async () => {
        const result = await controller.index(userFixture({id: USER}), undefined, undefined, "nonsense");
        expect(result).toEqual({data: [], meta: {page: 1, per_page: 25, total: 0, total_pages: 0}});
        expect(transactions.count).not.toHaveBeenCalled();
    });

    it("index rejects an invalid date range", async () => {
        await expect(controller.index(userFixture({id: USER}), "2026-09-01", "not-a-date")).rejects.toMatchObject({status: 422});
    });

    it("index rejects an invalid amount bound", async () => {
        await expect(controller.index(userFixture({id: USER}), undefined, undefined, undefined, undefined, undefined, undefined, undefined, "abc")).rejects.toMatchObject({status: 422});
    });

    it("index filters by kind, amount range and sorts descending", async () => {
        transactions.count.mockResolvedValue(1);
        transactions.find.mockResolvedValue([transactionFixture({id: "t1", occurred_at: "2026-09-14 10:00:00.000", amount_cents: 5_000})]);

        const result = (await controller.index(userFixture({id: USER}), undefined, undefined, "income", undefined, undefined, undefined, undefined, "1000", "9000", "-amount_cents", "2", "10")) as {
            data: unknown[];
            meta: Record<string, number>;
        };

        const countArgs = transactions.count.mock.calls[0]?.[0] as {where: Record<string, unknown>};
        expect(countArgs.where).toMatchObject({user_id: USER, kind: 0});
        expect(countArgs.where.amount_cents).toBeDefined();

        const findArgs = transactions.find.mock.calls[0]?.[0] as {order: Record<string, string>; skip: number; take: number};
        expect(findArgs.order).toEqual({amount_cents: "DESC"});
        expect(findArgs.skip).toBe(10);
        expect(findArgs.take).toBe(10);
        expect(result.meta).toMatchObject({page: 2, per_page: 10, total: 1, total_pages: 1});
    });

    it("index falls back to occurred_at ascending for an unknown sort", async () => {
        await controller.index(userFixture({id: USER}), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "hack");
        const findArgs = transactions.find.mock.calls[0]?.[0] as {order: Record<string, string>};
        expect(findArgs.order).toEqual({occurred_at: "ASC"});
    });

    it("index builds an OR search across note, payment method and merchant", async () => {
        merchants.find.mockResolvedValue([{id: "m1"}, {id: "m2"}]);

        await controller.index(userFixture({id: USER}), undefined, undefined, undefined, undefined, undefined, undefined, "coffee");

        const countArgs = transactions.count.mock.calls[0]?.[0] as {where: unknown};
        expect(Array.isArray(countArgs.where)).toBe(true);
        expect(countArgs.where as unknown[]).toHaveLength(3);
    });

    it("show 404s when the transaction is out of scope", async () => {
        transactions.findOne.mockResolvedValue(null);
        await expect(controller.show(userFixture({id: USER}), "missing")).rejects.toMatchObject({status: 404});
    });

    it("create decodes the raw body and delegates through idempotency", async () => {
        const response = mockResponse();
        const body = {account_id: "a1", kind: "expense", amount_cents: 1000, occurred_at: "2026-09-14T10:00:00+08:00"};

        await controller.create(userFixture({id: USER}), rawRequest(body, {"idempotency-key": "k1"}), response as never);

        expect(idempotency.wrap).toHaveBeenCalledWith(expect.objectContaining({userId: USER, method: "POST", path: "/api/v1/transactions", idempotencyKey: "k1"}));
        expect(service.createValidated).toHaveBeenCalledWith(USER, body);
        expect(service.incrementMerchantUsage).toHaveBeenCalledTimes(1);
        expect(response.status).toHaveBeenCalledWith(201);
        expect(response.json).toHaveBeenCalledTimes(1);
    });

    it("update validates against the existing transaction", async () => {
        const existing = transactionFixture({id: "t1"});
        transactions.findOne.mockResolvedValue(existing);
        service.updateValidated.mockResolvedValue(transactionFixture({id: "t1", amount_cents: 2_000}));

        const result = (await controller.update(userFixture({id: USER}), "t1", {amount_cents: 2_000})) as {data: Record<string, unknown>};

        expect(service.updateValidated).toHaveBeenCalledWith(USER, existing, {amount_cents: 2_000});
        expect(result.data.amount_cents).toBe(2_000);
    });

    it("destroy detaches references then deletes inside one transaction", async () => {
        transactions.findOne.mockResolvedValue(transactionFixture({id: "t1"}));

        await controller.destroy(userFixture({id: USER}), "t1");

        expect(ds.manager.delete).toHaveBeenCalledWith(Transaction, {id: "t1"});
        expect(ds.manager.update).toHaveBeenCalledTimes(2);
    });

    it("duplicate copies the row with a fresh id and current timestamp", async () => {
        const original = transactionFixture({id: "t1", amount_cents: 1_500, occurred_at: "2020-01-01 00:00:00.000"});
        transactions.findOne.mockResolvedValue(original);

        const result = (await controller.duplicate(userFixture({id: USER}), "t1")) as {data: Record<string, unknown>};

        const saved = transactions.save.mock.calls[0]?.[0] as Transaction;
        expect(saved.id).not.toBe("t1");
        expect(saved.amount_cents).toBe(1_500);
        expect(saved.occurred_at).not.toBe("2020-01-01 00:00:00.000");
        expect(result.data.id).toBe(saved.id);
    });
});

describe("TransactionsService (unit)", () => {
    let transactions: MockRepo;
    let accounts: MockRepo;
    let categories: MockRepo;
    let merchants: MockRepo;
    let service: TransactionsService;

    const base = {account_id: "a1", kind: "expense", amount_cents: 1000, occurred_at: "2026-09-14T10:00:00+08:00"};

    beforeEach(() => {
        transactions = mockRepo();
        accounts = mockRepo();
        categories = mockRepo();
        merchants = mockRepo();
        service = new TransactionsService(repo(transactions), repo(accounts), repo(categories), repo(merchants));
        accounts.findOne.mockResolvedValue(accountFixture({id: "a1"}));
    });

    it("rejects a transfer that points at its own account", async () => {
        await expect(service.createValidated(USER, {...base, kind: "transfer", transfer_account_id: "a1"})).rejects.toMatchObject({
            details: {transfer_account: ["無效"]},
        });
    });

    it("rejects a transfer without a destination", async () => {
        await expect(service.createValidated(USER, {...base, kind: "transfer"})).rejects.toMatchObject({details: {transfer_account: ["不可為空白"]}});
    });

    it("rejects a non-transfer carrying a transfer account", async () => {
        await expect(service.createValidated(USER, {...base, transfer_account_id: "a2"})).rejects.toMatchObject({details: {transfer_account: ["無效"]}});
    });

    it("rejects an account that is not owned", async () => {
        accounts.findOne.mockResolvedValue(null);
        await expect(service.createValidated(USER, base)).rejects.toMatchObject({details: {account: ["無效"]}});
    });

    it("rejects non-array image urls", async () => {
        await expect(service.createValidated(USER, {...base, image_urls: "nope"})).rejects.toBeInstanceOf(ApiError);
    });

    it("creates a validated transaction with the requested source override", async () => {
        await service.createValidated(USER, {...base, image_urls: ["https://x/y.jpg"]}, 2);

        const saved = transactions.save.mock.calls[0]?.[0] as Transaction;
        expect(saved).toMatchObject({user_id: USER, account_id: "a1", kind: 1, amount_cents: 1000, source: 2, image_urls: JSON.stringify(["https://x/y.jpg"])});
    });

    it("update keeps untouched nullable fields and applies touched ones", async () => {
        const existing = transactionFixture({id: "t1", account_id: "a1", category_id: "c1", note: "old", amount_cents: 1000});
        categories.findOne.mockResolvedValue(categoryFixture({id: "c1"}));

        await service.updateValidated(USER, existing, {amount_cents: 2_000});
        const firstSave = transactions.save.mock.calls[0]?.[0] as Transaction;
        expect(firstSave.category_id).toBe("c1");
        expect(firstSave.note).toBe("old");
        expect(firstSave.amount_cents).toBe(2_000);

        await service.updateValidated(USER, existing, {category_id: null, note: null});
        const secondSave = transactions.save.mock.calls[1]?.[0] as Transaction;
        expect(secondSave.category_id).toBeNull();
        expect(secondSave.note).toBeNull();
    });

    it("incrementMerchantUsage is a no-op without a merchant and bumps usage otherwise", async () => {
        await service.incrementMerchantUsage(transactionFixture({merchant_id: null}));
        expect(merchants.findOne).not.toHaveBeenCalled();

        merchants.findOne.mockResolvedValue(merchantFixture({id: "m1", usage_count: 4}));
        await service.incrementMerchantUsage(transactionFixture({merchant_id: "m1"}));
        expect(merchants.update).toHaveBeenCalledWith({id: "m1"}, expect.objectContaining({usage_count: 5}));
    });
});
