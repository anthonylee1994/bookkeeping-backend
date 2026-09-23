import {INestApplication} from "@nestjs/common";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

import * as time from "../src/common/time";
import {Transaction} from "../src/database/entities/transaction.entity";
import {DataSource} from "typeorm";
import {createApp, http, HttpClient, resetDatabase} from "./helpers/app";
import {at, authHeader, createAccount, createRule, createTransaction, registerAndLogin} from "./helpers/fixtures";

describe("summaries & dashboard", () => {
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

    it("daily totals exclude transfers", async () => {
        const fixture = await registerAndLogin(client);
        const savings = await createAccount(dataSource, fixture.userId, "Savings", 1);

        await createTransaction(dataSource, fixture.userId, fixture.accountId, 0, 100_000, at(2026, 9, 14, 10, 0), null, null, null, 0);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 50_000, at(2026, 9, 14, 11, 0), fixture.expenseCategoryId, null, null, 0);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 2, 20_000, at(2026, 9, 14, 12, 0), null, null, savings.id, 0);

        const response = await client.get("/api/v1/summaries/daily?date=2026-09-14").set(authHeader(fixture.token));
        expect(response.status).toBe(200);
        expect(response.body.data.income_cents).toBe(100_000);
        expect(response.body.data.expense_cents).toBe(50_000);
        expect(response.body.data.net_cents).toBe(50_000);
        expect(response.body.data.transfers.count).toBe(1);
        expect(response.body.data.transfers.total_cents).toBe(20_000);
        expect(response.body.data.by_category[0].expense_cents).toBe(50_000);
        const incomeSum = (response.body.data.by_category as Array<Record<string, number>>).reduce((sum, row) => sum + row.income_cents, 0);
        expect(incomeSum).toBe(100_000);
    });

    it("daily boundaries use hong kong time", async () => {
        const fixture = await registerAndLogin(client);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 0, 1_000, at(2026, 9, 14, 23, 59), null, null, null, 0);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 0, 2_000, at(2026, 9, 15, 0, 0), null, null, null, 0);

        const headers = authHeader(fixture.token);
        const first = await client.get("/api/v1/summaries/daily?date=2026-09-14").set(headers);
        expect(first.body.data.income_cents).toBe(1_000);
        const second = await client.get("/api/v1/summaries/daily?date=2026-09-15").set(headers);
        expect(second.body.data.income_cents).toBe(2_000);
    });

    it("weekly is monday to sunday and monthly uses month boundaries", async () => {
        const fixture = await registerAndLogin(client);
        for (const [day, amount] of [
            [13, 1_000],
            [14, 2_000],
            [20, 3_000],
            [21, 4_000],
        ] as Array<[number, number]>) {
            await createTransaction(dataSource, fixture.userId, fixture.accountId, 0, amount, at(2026, 9, day, 12, 0), null, null, null, 0);
        }
        const headers = authHeader(fixture.token);

        const firstWeek = await client.get("/api/v1/summaries/weekly?date=2026-09-14").set(headers);
        expect(firstWeek.body.data.income_cents).toBe(5_000);

        const secondWeek = await client.get("/api/v1/summaries/weekly?date=2026-09-21").set(headers);
        expect(secondWeek.body.data.income_cents).toBe(4_000);

        await createTransaction(dataSource, fixture.userId, fixture.accountId, 0, 5_000, at(2026, 9, 30, 23, 59), null, null, null, 0);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 0, 6_000, at(2026, 10, 1, 0, 0), null, null, null, 0);
        const monthly = await client.get("/api/v1/summaries/monthly?date=2026-09-14").set(headers);
        expect(monthly.body.data.income_cents).toBe(15_000);
    });

    it("paginates summary transactions", async () => {
        const fixture = await registerAndLogin(client);
        for (let index = 0; index < 3; index += 1) {
            await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 1_000 + index, at(2026, 9, 14, 10 + index, 0), null, null, null, 0);
        }
        const response = await client.get("/api/v1/summaries/daily?date=2026-09-14&page=2&per_page=2").set(authHeader(fixture.token));
        expect(response.body.data.transactions.data).toHaveLength(1);
        expect(response.body.data.transactions.meta.total).toBe(3);
        expect(response.body.data.transactions.meta.total_pages).toBe(2);
    });

    it("monthly returns daily breakdown", async () => {
        const fixture = await registerAndLogin(client);
        const savings = await createAccount(dataSource, fixture.userId, "Savings", 1);

        await createTransaction(dataSource, fixture.userId, fixture.accountId, 0, 1_000, at(2026, 9, 1, 10, 0), null, null, null, 0);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 400, at(2026, 9, 1, 11, 0), null, null, null, 0);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 0, 2_000, at(2026, 9, 3, 9, 0), null, null, null, 0);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 2, 5_000, at(2026, 9, 3, 12, 0), null, null, savings.id, 0);

        const response = await client.get("/api/v1/summaries/monthly?date=2026-09-14").set(authHeader(fixture.token));
        const daily = response.body.data.daily as Array<Record<string, unknown>>;
        expect(daily).toHaveLength(2);
        expect(daily[0].date).toBe("2026-09-01");
        expect(daily[0].net_cents).toBe(600);
        expect(daily[1].date).toBe("2026-09-03");
        expect(daily[1].net_cents).toBe(2_000);
        expect(Object.keys(daily[0])).toHaveLength(2);
    });

    it("includes boundary transactions stored without fractional seconds", async () => {
        const fixture = await registerAndLogin(client);
        const transaction = await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 1_000_000, at(2026, 9, 1, 0, 0), fixture.expenseCategoryId, null, null, 0);
        // Legacy Rails / loco.rs rows stored datetimes without a fractional part;
        // a fraction-less value sorts before the same instant written as "...00.000".
        await dataSource.getRepository(Transaction).update({id: transaction.id}, {occurred_at: "2026-09-01 00:00:00"});

        const headers = authHeader(fixture.token);
        const monthly = await client.get("/api/v1/summaries/monthly?date=2026-09-14").set(headers);
        expect(monthly.body.data.expense_cents).toBe(1_000_000);
        expect((monthly.body.data.by_category as Array<Record<string, unknown>>)[0].category_id).toBe(fixture.expenseCategoryId);

        const daily = await client.get("/api/v1/summaries/daily?date=2026-09-01").set(headers);
        expect(daily.body.data.expense_cents).toBe(1_000_000);

        const dashboard = await client.get("/api/v1/dashboard?date=2026-09-14").set(headers);
        expect(dashboard.body.data.expense_cents).toBe(1_000_000);
    });

    it("dashboard returns monthly metrics and reminders", async () => {
        const fixture = await registerAndLogin(client);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 0, 10_000, at(2026, 9, 10, 12, 0), null, null, null, 0);
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 3_000, at(2026, 9, 11, 12, 0), null, null, null, 0);

        await createRule(dataSource, fixture.userId, fixture.accountId, 0, time.addDays(time.nowLocal(), 3), null, null);
        await createRule(dataSource, fixture.userId, fixture.accountId, 0, time.addDays(time.nowLocal(), 8), null, null);

        const response = await client.get("/api/v1/dashboard?date=2026-09-14").set(authHeader(fixture.token));
        expect(response.status).toBe(200);
        expect(response.body.data.income_cents).toBe(10_000);
        expect(response.body.data.expense_cents).toBe(3_000);
        expect(response.body.data.net_cents).toBe(7_000);
        expect(response.body.data.recent_transactions).toHaveLength(2);
        expect(response.body.data.recurring_reminders).toHaveLength(1);
        expect(response.body.data.upcoming_recurring).toHaveLength(1);
    });
});
