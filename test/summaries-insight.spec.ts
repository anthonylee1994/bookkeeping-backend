import {INestApplication} from "@nestjs/common";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {DataSource} from "typeorm";

import {Merchant} from "../src/database/entities/merchant.entity";
import {Transaction} from "../src/database/entities/transaction.entity";

import {createApp, http, HttpClient, resetDatabase} from "./helpers/app";
import {at, authHeader, createMerchant, createTransaction, registerAndLogin} from "./helpers/fixtures";
import {MockResponse, MockServer, startMockServer} from "./helpers/mock-server";

function deepseekInsight(summary: string, highlights: string[] = []): string {
    return JSON.stringify({
        choices: [{message: {content: JSON.stringify({summary, highlights})}}],
        usage: {prompt_tokens: 20, completion_tokens: 10},
    });
}

const VALID_SUMMARY = "2026年9月收入 HK$1,000.00，支出 HK$400.00，淨額 HK$600.00。";

describe("summaries insight", () => {
    let app: INestApplication;
    let client: HttpClient;
    let dataSource: DataSource;
    const servers: MockServer[] = [];

    beforeAll(async () => {
        app = await createApp();
        client = http(app);
        dataSource = app.get(DataSource);
    });

    beforeEach(async () => {
        await resetDatabase(dataSource);
    });

    afterEach(async () => {
        await Promise.all(servers.splice(0).map(server => server.close()));
    });

    afterAll(async () => {
        await app.close();
    });

    async function mockServer(handler: (request: Parameters<Parameters<typeof startMockServer>[0]>[0]) => MockResponse): Promise<MockServer> {
        const server = await startMockServer(handler);
        servers.push(server);
        process.env.DEEPSEEK_BASE_URL = server.uri;
        process.env.DEEPSEEK_API_KEY = "test-key";
        process.env.DEEPSEEK_MODEL = "deepseek-flash";
        return server;
    }

    async function seed(fixture: Awaited<ReturnType<typeof registerAndLogin>>): Promise<{expenseId: string; merchantId: string}> {
        await createTransaction(dataSource, fixture.userId, fixture.accountId, 0, 100_000, at(2026, 9, 16, 9), null, null, null, 0);
        const merchant = await createMerchant(dataSource, fixture.userId, "大快活", 1, fixture.expenseCategoryId);
        const expense = await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 40_000, at(2026, 9, 16, 12), fixture.expenseCategoryId, merchant.id, null, 0, "同朋友食飯");
        return {expenseId: expense.id, merchantId: merchant.id};
    }

    it("generates an insight, caches it, and invalidates when data changes", async () => {
        const server = await mockServer(() => ({status: 200, headers: {"content-type": "application/json"}, body: deepseekInsight(VALID_SUMMARY, ["支出主要係飲食。"])}));
        const fixture = await registerAndLogin(client);
        await seed(fixture);

        const first = await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16").set(authHeader(fixture.token));
        expect(first.status).toBe(200);
        expect(first.body.data).toMatchObject({status: "success", cached: false});
        expect(first.body.data.text).toBe(VALID_SUMMARY);
        expect(first.body.data.highlights).toEqual(["支出主要係飲食。"]);
        expect(server.countRequests("/chat/completions")).toBe(1);

        // 期內每筆交易（連商戶同 note）都要餵入 fact sheet，等 AI 可以引用個別交易。
        const prompt = JSON.parse(server.requests[0].body.toString()).messages[0].content as string;
        expect(prompt).toContain("期內交易（按時間順序，共 2 筆）：");
        expect(prompt).toMatch(/2026-09-16 收入 分類：未分類 HK\$1,000\.00/);
        expect(prompt).toMatch(/2026-09-16 支出 分類：.+ 商戶：大快活 HK\$400\.00 備註：同朋友食飯/);

        const second = await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16").set(authHeader(fixture.token));
        expect(second.body.data.cached).toBe(true);
        expect(server.countRequests("/chat/completions")).toBe(1);

        await createTransaction(dataSource, fixture.userId, fixture.accountId, 1, 5_000, at(2026, 9, 17, 13), fixture.expenseCategoryId, null, null, 0);
        const third = await client.get("/api/v1/summaries/monthly/insight?date=2026-09-20").set(authHeader(fixture.token));
        expect(third.body.data.cached).toBe(false);
        expect(server.countRequests("/chat/completions")).toBe(2);
    });

    it("reuses the same cache across different dates within one period", async () => {
        const server = await mockServer(() => ({status: 200, headers: {"content-type": "application/json"}, body: deepseekInsight(VALID_SUMMARY)}));
        const fixture = await registerAndLogin(client);
        await seed(fixture);

        await client.get("/api/v1/summaries/monthly/insight?date=2026-09-01").set(authHeader(fixture.token));
        const other = await client.get("/api/v1/summaries/monthly/insight?date=2026-09-25").set(authHeader(fixture.token));

        expect(other.body.data.cached).toBe(true);
        expect(server.countRequests("/chat/completions")).toBe(1);
    });

    it("regenerates on refresh", async () => {
        const server = await mockServer(() => ({status: 200, headers: {"content-type": "application/json"}, body: deepseekInsight(VALID_SUMMARY)}));
        const fixture = await registerAndLogin(client);
        await seed(fixture);

        await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16").set(authHeader(fixture.token));
        const refreshed = await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16&refresh=1").set(authHeader(fixture.token));

        expect(refreshed.body.data.cached).toBe(false);
        expect(server.countRequests("/chat/completions")).toBe(2);
    });

    it("regenerates when only a transaction note changes", async () => {
        const server = await mockServer(() => ({status: 200, headers: {"content-type": "application/json"}, body: deepseekInsight(VALID_SUMMARY)}));
        const fixture = await registerAndLogin(client);
        const {expenseId} = await seed(fixture);

        await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16").set(authHeader(fixture.token));
        expect(server.countRequests("/chat/completions")).toBe(1);

        await dataSource.getRepository(Transaction).update({id: expenseId}, {note: "轉咗做買餸"});

        const after = await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16").set(authHeader(fixture.token));
        expect(after.body.data.cached).toBe(false);
        expect(server.countRequests("/chat/completions")).toBe(2);
    });

    it("regenerates when a merchant is renamed", async () => {
        const server = await mockServer(() => ({status: 200, headers: {"content-type": "application/json"}, body: deepseekInsight(VALID_SUMMARY)}));
        const fixture = await registerAndLogin(client);
        const {merchantId} = await seed(fixture);

        await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16").set(authHeader(fixture.token));
        expect(server.countRequests("/chat/completions")).toBe(1);

        await dataSource.getRepository(Merchant).update({id: merchantId}, {name: "大家樂"});

        const after = await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16").set(authHeader(fixture.token));
        expect(after.body.data.cached).toBe(false);
        expect(server.countRequests("/chat/completions")).toBe(2);
    });

    it("caches a rejected response so it does not spend tokens again", async () => {
        const server = await mockServer(() => ({status: 200, headers: {"content-type": "application/json"}, body: deepseekInsight("支出 HK$999.00。")}));
        const fixture = await registerAndLogin(client);
        await seed(fixture);

        const first = await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16").set(authHeader(fixture.token));
        expect(first.body.data.status).toBe("failed");
        expect(first.body.data.text).toBeNull();
        expect(first.body.data.error).toContain("999.00");

        const second = await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16").set(authHeader(fixture.token));
        expect(second.body.data.status).toBe("failed");
        expect(second.body.data.cached).toBe(true);
        expect(server.countRequests("/chat/completions")).toBe(1);
    });

    it("returns empty without calling the model when the period has no data", async () => {
        const server = await mockServer(() => ({status: 200, headers: {"content-type": "application/json"}, body: deepseekInsight(VALID_SUMMARY)}));
        const fixture = await registerAndLogin(client);

        const response = await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16").set(authHeader(fixture.token));
        expect(response.status).toBe(200);
        expect(response.body.data.status).toBe("empty");
        expect(server.countRequests("/chat/completions")).toBe(0);
    });

    it("rejects an unsupported period and an invalid date", async () => {
        await mockServer(() => ({status: 404}));
        const fixture = await registerAndLogin(client);

        const period = await client.get("/api/v1/summaries/yearly/insight?date=2026-09-16").set(authHeader(fixture.token));
        expect(period.status).toBe(422);

        const daily = await client.get("/api/v1/summaries/daily/insight?date=2026-09-16").set(authHeader(fixture.token));
        expect(daily.status).toBe(422);

        const date = await client.get("/api/v1/summaries/monthly/insight?date=nope").set(authHeader(fixture.token));
        expect(date.status).toBe(422);
    });

    it("requires authentication", async () => {
        await mockServer(() => ({status: 404}));
        const response = await client.get("/api/v1/summaries/monthly/insight?date=2026-09-16");
        expect(response.status).toBe(401);
    });
});
