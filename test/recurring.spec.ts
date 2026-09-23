import {INestApplication} from "@nestjs/common";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

import * as time from "../src/common/time";
import {DataSource} from "typeorm";
import {createApp, http, HttpClient, resetDatabase} from "./helpers/app";
import {authHeader, countOccurrences, countOccurrencesWithoutTransaction, countTransactions, createRule, findRule, listTransactions, registerAndLogin} from "./helpers/fixtures";

function inHours(hours: number): string {
    return time.formatDatetime(time.addHours(time.nowLocal(), hours));
}

describe("recurring rules", () => {
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

    it("creates and pauses/resumes a rule", async () => {
        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);
        const created = await client
            .post("/api/v1/recurring_rules")
            .set(headers)
            .send({
                account_id: fixture.accountId,
                kind: "expense",
                amount_cents: 1000,
                frequency: "daily",
                interval: 1,
                start_on: time.toDbDate(time.today()),
                next_run_at: inHours(1),
            });
        expect(created.status).toBe(201);
        const id = created.body.data.id as string;

        const paused = await client.post(`/api/v1/recurring_rules/${id}/pause`).set(headers);
        expect(paused.body.data.status).toBe("paused");

        const resumed = await client.post(`/api/v1/recurring_rules/${id}/resume`).set(headers);
        expect(resumed.body.data.status).toBe("active");
    });

    it("updates a rule and clears nullable fields", async () => {
        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);
        const created = await client
            .post("/api/v1/recurring_rules")
            .set(headers)
            .send({
                account_id: fixture.accountId,
                category_id: fixture.expenseCategoryId,
                kind: "expense",
                amount_cents: 1000,
                frequency: "daily",
                interval: 1,
                start_on: time.toDbDate(time.today()),
                note: "before",
                next_run_at: inHours(1),
            });
        expect(created.status).toBe(201);
        const id = created.body.data.id as string;

        const updated = await client.patch(`/api/v1/recurring_rules/${id}`).set(headers).send({amount_cents: 2500, note: "after"});
        expect(updated.status).toBe(200);
        expect(updated.body.data.amount_cents).toBe(2500);
        expect(updated.body.data.note).toBe("after");
        expect(updated.body.data.interval).toBe(1);
        expect(updated.body.data.frequency).toBe("daily");

        const cleared = await client.patch(`/api/v1/recurring_rules/${id}`).set(headers).send({category_id: null});
        expect(cleared.status).toBe(200);
        expect(cleared.body.data.category_id).toBeNull();
    });

    it("rejects invalid rule updates", async () => {
        const fixture = await registerAndLogin(client);
        const rule = await createRule(dataSource, fixture.userId, fixture.accountId, 0, time.addHours(time.nowLocal(), 1), null, null);

        const response = await client.patch(`/api/v1/recurring_rules/${rule.id}`).set(authHeader(fixture.token)).send({amount_cents: 0, interval: 0});
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe("validation_error");
    });

    it("lists and filters rules by status", async () => {
        const fixture = await registerAndLogin(client);
        await createRule(dataSource, fixture.userId, fixture.accountId, 0, time.addHours(time.nowLocal(), 1), null, "active rule");
        await createRule(dataSource, fixture.userId, fixture.accountId, 1, time.addHours(time.nowLocal(), 1), null, "paused rule");
        const headers = authHeader(fixture.token);

        const all = await client.get("/api/v1/recurring_rules").set(headers);
        const notes = (all.body.data as Array<Record<string, unknown>>).map(row => row.note);
        expect(notes).toContain("active rule");
        expect(notes).toContain("paused rule");

        const paused = await client.get("/api/v1/recurring_rules?status=paused").set(headers);
        expect(paused.body.data).toHaveLength(1);
        expect(paused.body.data[0].note).toBe("paused rule");

        const ended = await client.get("/api/v1/recurring_rules?status=ended").set(headers);
        expect(ended.body.data).toEqual([]);

        const bogus = await client.get("/api/v1/recurring_rules?status=bogus").set(headers);
        expect(bogus.status).toBe(200);
        expect(bogus.body.data).toEqual([]);
    });

    it("run_now materializes once then conflicts", async () => {
        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);
        const created = await client
            .post("/api/v1/recurring_rules")
            .set(headers)
            .send({
                account_id: fixture.accountId,
                kind: "expense",
                amount_cents: 1000,
                frequency: "daily",
                interval: 1,
                start_on: time.toDbDate(time.today()),
                next_run_at: inHours(1),
            });
        const id = created.body.data.id as string;

        const first = await client.post(`/api/v1/recurring_rules/${id}/run_now`).set(headers);
        expect(first.status).toBe(200);
        expect(first.body.data.net_amount_cents).toBe(1000);

        const second = await client.post(`/api/v1/recurring_rules/${id}/run_now`).set(headers);
        expect(second.status).toBe(409);
        expect(second.body.error.code).toBe("already_materialized");
    });

    it("catch up materializes exactly once", async () => {
        const fixture = await registerAndLogin(client);
        await createRule(dataSource, fixture.userId, fixture.accountId, 0, time.addDays(time.nowLocal(), -2), null, null);

        const headers = authHeader(fixture.token);
        await client.get("/api/v1/me").set(headers);
        const count = await countTransactions(dataSource, fixture.userId, 1);
        expect(count).toBeGreaterThanOrEqual(1);

        await client.get("/api/v1/me").set(headers);
        expect(await countTransactions(dataSource, fixture.userId, 1)).toBe(count);
    });

    it("skip_next does not create a transaction", async () => {
        const fixture = await registerAndLogin(client);
        const rule = await createRule(dataSource, fixture.userId, fixture.accountId, 0, time.addHours(time.nowLocal(), 1), null, null);

        const response = await client.post(`/api/v1/recurring_rules/${rule.id}/skip_next`).set(authHeader(fixture.token));
        expect(response.status).toBe(200);
        expect(await countOccurrencesWithoutTransaction(dataSource, rule.id)).toBe(1);
        expect(await countTransactions(dataSource, fixture.userId, 1)).toBe(0);
    });

    it("does not recreate a deleted recurring transaction", async () => {
        const fixture = await registerAndLogin(client);
        const rule = await createRule(dataSource, fixture.userId, fixture.accountId, 0, time.addHours(time.nowLocal(), -1), null, null);

        const headers = authHeader(fixture.token);
        await client.get("/api/v1/me").set(headers);

        const transactions = await listTransactions(dataSource, fixture.userId, 1);
        expect(transactions).toHaveLength(1);
        const deleted = await client.delete(`/api/v1/transactions/${transactions[0].id}`).set(headers);
        expect(deleted.status).toBe(204);

        await client.get("/api/v1/me").set(headers);
        expect(await countTransactions(dataSource, fixture.userId, 1)).toBe(0);
        expect(await countOccurrencesWithoutTransaction(dataSource, rule.id)).toBeGreaterThanOrEqual(1);
    });

    it("ends a rule after its end date", async () => {
        const fixture = await registerAndLogin(client);
        const rule = await createRule(dataSource, fixture.userId, fixture.accountId, 0, time.addDays(time.nowLocal(), -2), time.addDays(time.today(), -1), null);

        await client.get("/api/v1/me").set(authHeader(fixture.token));
        expect((await findRule(dataSource, rule.id)).status).toBe(2);
    });

    it("backfill disabled materializes only the latest occurrence", async () => {
        const fixture = await registerAndLogin(client);
        const rule = await createRule(dataSource, fixture.userId, fixture.accountId, 0, time.addDays(time.nowLocal(), -3), null, null);

        await client.get("/api/v1/me").set(authHeader(fixture.token));
        expect(await countOccurrences(dataSource, rule.id)).toBe(4);
        expect(await countTransactions(dataSource, fixture.userId, 1)).toBe(1);
    });

    it("backfill enabled materializes every due occurrence", async () => {
        const fixture = await registerAndLogin(client);
        const rule = await createRule(dataSource, fixture.userId, fixture.accountId, 0, time.addDays(time.nowLocal(), -3), null, null);

        process.env.RECURRING_BACKFILL_ENABLED = "true";
        try {
            await client.get("/api/v1/me").set(authHeader(fixture.token));
        } finally {
            delete process.env.RECURRING_BACKFILL_ENABLED;
        }

        expect(await countOccurrences(dataSource, rule.id)).toBe(4);
        expect(await countTransactions(dataSource, fixture.userId, 1)).toBe(4);
    });
});
