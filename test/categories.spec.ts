import {INestApplication} from "@nestjs/common";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

import {DataSource} from "typeorm";
import {createApp, http, HttpClient, resetDatabase} from "./helpers/app";
import {authHeader, createCategory, registerAndLogin, registerNamed} from "./helpers/fixtures";

function namesOfKind(rows: Array<Record<string, unknown>>, kind: string): string[] {
    return rows.filter(row => row.kind === kind).map(row => row.name as string);
}

describe("categories", () => {
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

    it("seeds the expected default categories", async () => {
        const fixture = await registerAndLogin(client);
        const response = await client.get("/api/v1/categories").set(authHeader(fixture.token));
        expect(response.status).toBe(200);
        const rows = response.body.data as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(13);

        expect(namesOfKind(rows, "expense")).toEqual(["飲食", "交通", "娛樂", "購物", "醫療", "住屋", "水電", "其他支出"]);
        expect(namesOfKind(rows, "income")).toEqual(["薪水", "獎金", "投資", "兼職", "其他收入"]);
        expect(rows.some(row => row.name === "收入")).toBe(false);

        expect(rows.every(row => row.color === "#ecf0f1")).toBe(true);

        const icons = new Map(rows.map(row => [row.name as string, row.icon as string]));
        expect(Object.fromEntries(icons)).toEqual({
            飲食: "mdi:food",
            交通: "mdi:bus",
            娛樂: "mdi:music",
            購物: "mdi:cart",
            醫療: "mdi:medical-bag",
            住屋: "mdi:home",
            水電: "mdi:lightning-bolt",
            其他支出: "mdi:credit-card",
            薪水: "mdi:bank",
            獎金: "mdi:gift",
            投資: "mdi:piggy-bank",
            兼職: "mdi:cash",
            其他收入: "mdi:wallet",
        });
    });

    it("filters, creates, updates and deletes categories", async () => {
        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);

        const created = await client.post("/api/v1/categories").set(headers).send({name: "寵物", kind: "expense"});
        expect(created.status).toBe(201);
        const categoryId = created.body.data.id as string;

        const updated = await client.patch(`/api/v1/categories/${categoryId}`).set(headers).send({name: "毛孩"});
        expect(updated.status).toBe(200);
        expect(updated.body.data.name).toBe("毛孩");

        const filtered = await client.get("/api/v1/categories?kind=expense").set(headers);
        expect((filtered.body.data as Array<Record<string, unknown>>).every(row => row.kind === "expense")).toBe(true);

        const deleted = await client.delete(`/api/v1/categories/${categoryId}`).set(headers);
        expect(deleted.status).toBe(204);
    });

    it("does not expose another users category", async () => {
        const fixture = await registerAndLogin(client);
        const bob = await registerNamed(client, "bob");
        const bobCategory = await createCategory(dataSource, bob.userId, "Bob 分類", 1);

        const response = await client.delete(`/api/v1/categories/${bobCategory.id}`).set(authHeader(fixture.token));
        expect(response.status).toBe(404);
    });
});
