import {INestApplication} from "@nestjs/common";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

import {DataSource} from "typeorm";
import {createApp, http, HttpClient, resetDatabase} from "./helpers/app";
import {at, authHeader, createAccount, createTransaction, registerAndLogin, registerNamed} from "./helpers/fixtures";

describe("accounts", () => {
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

    it("lists the default cash account", async () => {
        const fixture = await registerAndLogin(client);
        const response = await client.get("/api/v1/accounts").set(authHeader(fixture.token));
        expect(response.status).toBe(200);
        const rows = response.body.data as Array<Record<string, unknown>>;
        expect(rows.some(row => row.name === "現金")).toBe(true);
        expect(rows.some(row => row.kind === "cash")).toBe(true);
        expect(rows.some(row => row.color === "#ecf0f1")).toBe(true);
    });

    it("creates, updates and deletes an unused account", async () => {
        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);

        const created = await client.post("/api/v1/accounts").set(headers).send({name: "銀行", kind: "bank", initial_balance_cents: 500});
        expect(created.status).toBe(201);
        const accountId = created.body.data.id as string;

        const updated = await client.patch(`/api/v1/accounts/${accountId}`).set(headers).send({name: "儲蓄戶口"});
        expect(updated.status).toBe(200);
        expect(updated.body.data.name).toBe("儲蓄戶口");

        const deleted = await client.delete(`/api/v1/accounts/${accountId}`).set(headers);
        expect(deleted.status).toBe(204);
    });

    it("does not expose another users account", async () => {
        const fixture = await registerAndLogin(client);
        const bob = await registerNamed(client, "bob");
        const bobAccount = await createAccount(dataSource, bob.userId, "Bob 現金", 0);

        const response = await client.patch(`/api/v1/accounts/${bobAccount.id}`).set(authHeader(fixture.token)).send({name: "stolen"});
        expect(response.status).toBe(404);
    });

    it("returns account_in_use when dependent records exist", async () => {
        const fixture = await registerAndLogin(client);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 1000, at(2026, 9, 14, 12, 0), fixture.expenseCategoryId, null, null, 0);

        const response = await client.delete(`/api/v1/accounts/${fixture.accountId}`).set(authHeader(fixture.token));
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe("account_in_use");
    });
});
