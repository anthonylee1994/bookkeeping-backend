import {INestApplication} from "@nestjs/common";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

import * as time from "../src/common/time";
import {DataSource} from "typeorm";
import {IdempotencyKey} from "../src/database/entities/idempotency-key.entity";
import {cleanup} from "../src/tasks/maintenance";
import {createApp, http, HttpClient, resetDatabase} from "./helpers/app";
import {createIdempotencyKey, registerAndLogin} from "./helpers/fixtures";

describe("health & docs", () => {
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

    it("up returns ok", async () => {
        const response = await client.get("/up");
        expect(response.status).toBe(200);
    });

    it("api-docs serves the OpenAPI definition", async () => {
        const response = await client.get("/api-docs");
        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("application/yaml");
        expect(response.text).toContain("Bookkeeping API");
    });

    it("maintenance cleanup removes expired idempotency keys", async () => {
        const fixture = await registerAndLogin(client);
        const now = time.nowLocal();
        await createIdempotencyKey(dataSource, fixture.userId, "old", time.addHours(now, -25));
        await createIdempotencyKey(dataSource, fixture.userId, "recent", time.addHours(now, -1));

        await cleanup(dataSource);

        const remaining = await dataSource.getRepository(IdempotencyKey).find({
            where: {user_id: fixture.userId},
        });
        expect(remaining).toHaveLength(1);
        expect(remaining[0].key).toBe("recent");
    });
});
