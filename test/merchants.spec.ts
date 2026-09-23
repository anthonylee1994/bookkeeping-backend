import {INestApplication} from "@nestjs/common";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

import {DataSource} from "typeorm";
import {createApp, http, HttpClient, resetDatabase} from "./helpers/app";
import {authHeader, createCategory, createMerchant, registerAndLogin, registerNamed} from "./helpers/fixtures";

describe("merchants", () => {
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

    it("search returns at most ten ordered by usage", async () => {
        const fixture = await registerAndLogin(client);
        for (let index = 0; index < 11; index += 1) {
            await createMerchant(dataSource, fixture.userId, `Coffee ${index}`, index, null);
        }
        await createMerchant(dataSource, fixture.userId, "Tea", 100, null);
        const bob = await registerNamed(client, "bob");
        await createMerchant(dataSource, bob.userId, "Coffee outsider", 200, null);

        const response = await client.get("/api/v1/merchants?q=coffee").set(authHeader(fixture.token));
        expect(response.status).toBe(200);
        const rows = response.body.data as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(10);
        expect(rows[0].name).toBe("Coffee 10");
        expect(rows.some(row => row.name === "Coffee outsider")).toBe(false);
        expect(rows.some(row => row.name === "Coffee 0")).toBe(false);
    });

    it("no query returns all owned merchants", async () => {
        const fixture = await registerAndLogin(client);
        for (let index = 0; index < 12; index += 1) {
            await createMerchant(dataSource, fixture.userId, `Merchant ${index}`, index, null);
        }
        const bob = await registerNamed(client, "bob");
        await createMerchant(dataSource, bob.userId, "Outsider", 0, null);

        const response = await client.get("/api/v1/merchants").set(authHeader(fixture.token));
        const rows = response.body.data as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(12);
        expect(rows.some(row => row.name === "Outsider")).toBe(false);
    });

    it("deleting a category nullifies a merchant default category", async () => {
        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);

        const created = await client.post("/api/v1/merchants").set(headers).send({name: "Cafe", default_category_id: fixture.expenseCategoryId});
        expect(created.status).toBe(201);
        const merchantId = created.body.data.id as string;

        const deleted = await client.delete(`/api/v1/categories/${fixture.expenseCategoryId}`).set(headers);
        expect(deleted.status).toBe(204);

        const list = await client.get("/api/v1/merchants?q=Cafe").set(headers);
        const merchant = (list.body.data as Array<Record<string, unknown>>).find(row => row.id === merchantId);
        expect(merchant?.default_category_id).toBeNull();
    });

    it("rejects another users category as default", async () => {
        const fixture = await registerAndLogin(client);
        const bob = await registerNamed(client, "bob");
        const bobCategory = await createCategory(dataSource, bob.userId, "Bob 分類", 1);

        const response = await client.post("/api/v1/merchants").set(authHeader(fixture.token)).send({name: "Cafe", default_category_id: bobCategory.id});
        expect(response.status).toBe(422);
    });

    it("updates a merchants name and default category", async () => {
        const fixture = await registerAndLogin(client);
        const merchant = await createMerchant(dataSource, fixture.userId, "Cafe", 0, null);

        const response = await client.patch(`/api/v1/merchants/${merchant.id}`).set(authHeader(fixture.token)).send({name: "Coffee Shop", default_category_id: fixture.expenseCategoryId});
        expect(response.status).toBe(200);
        expect(response.body.data.name).toBe("Coffee Shop");
        expect(response.body.data.default_category_id).toBe(fixture.expenseCategoryId);
    });

    it("rejects updating to another users category", async () => {
        const fixture = await registerAndLogin(client);
        const merchant = await createMerchant(dataSource, fixture.userId, "Cafe", 0, null);
        const bob = await registerNamed(client, "bob");
        const bobCategory = await createCategory(dataSource, bob.userId, "Bob 分類", 1);

        const response = await client.patch(`/api/v1/merchants/${merchant.id}`).set(authHeader(fixture.token)).send({default_category_id: bobCategory.id});
        expect(response.status).toBe(422);
    });

    it("does not update another users merchant", async () => {
        const fixture = await registerAndLogin(client);
        const bob = await registerNamed(client, "bob");
        const bobMerchant = await createMerchant(dataSource, bob.userId, "Cafe", 0, null);

        const response = await client.patch(`/api/v1/merchants/${bobMerchant.id}`).set(authHeader(fixture.token)).send({name: "Hacked"});
        expect(response.status).toBe(404);
    });
});
