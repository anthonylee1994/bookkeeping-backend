import {INestApplication} from "@nestjs/common";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

import {DataSource} from "typeorm";
import {createApp, http, HttpClient, resetDatabase} from "./helpers/app";
import {at, authHeader, createMerchant, createTransaction, idempotencyHeader, listTransactions, registerAndLogin} from "./helpers/fixtures";

describe("transactions", () => {
    let app: INestApplication;
    let client: HttpClient;
    let dataSource: DataSource;

    beforeAll(async () => {
        app = await createApp();
        client = http(app);
        dataSource = app.get(DataSource);
    });

    beforeEach(async () => {
        await resetDatabase(dataSource);
    });

    afterAll(async () => {
        await app.close();
    });

    it("creates and lists with filter and pagination", async () => {
        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);

        const created = await client.post("/api/v1/transactions").set(headers).set(idempotencyHeader("create-key")).send({
            account_id: fixture.accountId,
            kind: "expense",
            amount_cents: 1000,
            occurred_at: "2026-09-14T10:00:00+08:00",
        });
        expect(created.status).toBe(201);

        const listed = await client.get("/api/v1/transactions?kind=expense&per_page=1").set(headers);
        expect(listed.status).toBe(200);
        expect(listed.body.data[0].amount_cents).toBe(1000);
        expect(listed.body.meta.total).toBe(1);
        expect(listed.body.meta.per_page).toBe(1);
    });

    it("search query matches merchant name", async () => {
        const fixture = await registerAndLogin(client);
        const merchant = await createMerchant(dataSource, fixture.userId, "Starbucks", 0, null);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 1000, at(2026, 9, 14, 12, 0), null, merchant.id, null, 0);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 2000, at(2026, 9, 14, 13, 0), null, null, null, 0);

        const response = await client.get("/api/v1/transactions?q=starbucks").set(authHeader(fixture.token));
        expect(response.body.meta.total).toBe(1);
        expect(response.body.data[0].merchant_id).toBe(merchant.id);
    });

    it("rejects invalid transfers", async () => {
        const fixture = await registerAndLogin(client);
        const response = await client.post("/api/v1/transactions").set(authHeader(fixture.token)).send({
            account_id: fixture.accountId,
            kind: "transfer",
            amount_cents: 1000,
            occurred_at: "2026-09-14T10:00:00+08:00",
            category_id: "bad",
        });
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe("validation_error");
    });

    it("repeated create is idempotent", async () => {
        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);
        const payload = {
            account_id: fixture.accountId,
            kind: "expense",
            amount_cents: 1000,
            occurred_at: "2026-09-14T10:00:00+08:00",
        };

        const first = await client.post("/api/v1/transactions").set(headers).set(idempotencyHeader("key-1")).send(payload);
        expect(first.status).toBe(201);
        const firstId = first.body.data.id;

        const second = await client.post("/api/v1/transactions").set(headers).set(idempotencyHeader("key-1")).send(payload);
        expect(second.status).toBe(201);
        expect(second.body.data.id).toBe(firstId);
        expect((await listTransactions(dataSource, fixture.userId, 0)).length).toBe(1);
    });

    it("rejects idempotency key reuse with different body", async () => {
        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);
        const base = {
            account_id: fixture.accountId,
            kind: "expense",
            amount_cents: 1000,
            occurred_at: "2026-09-14T10:00:00+08:00",
        };
        await client.post("/api/v1/transactions").set(headers).set(idempotencyHeader("key-2")).send(base);

        const conflict = await client
            .post("/api/v1/transactions")
            .set(headers)
            .set(idempotencyHeader("key-2"))
            .send({...base, amount_cents: 2000});
        expect(conflict.status).toBe(422);
        expect(conflict.body.error.code).toBe("idempotency_conflict");
    });

    it("duplicates a transaction with a new id", async () => {
        const fixture = await registerAndLogin(client);
        const original = await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 1000, at(2026, 9, 14, 12, 0), null, null, null, 0);

        const response = await client.post(`/api/v1/transactions/${original.id}/duplicate`).set(authHeader(fixture.token));
        expect(response.status).toBe(201);
        expect(response.body.data.id).not.toBe(original.id);
    });

    it("does not expose another users transaction", async () => {
        const fixture = await registerAndLogin(client);
        const other = await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 1000, at(2026, 9, 14, 12, 0), null, null, null, 0);

        const bob = await client.post("/api/v1/auth/register").send({username: "bob", password: "secret123"});
        const bobToken = bob.body.data.token as string;

        const response = await client.get(`/api/v1/transactions/${other.id}`).set(authHeader(bobToken));
        expect(response.status).toBe(404);
    });
});
