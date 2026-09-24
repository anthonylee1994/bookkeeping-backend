import {INestApplication} from "@nestjs/common";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";

import {sha256Hex} from "../src/common/util";
import {DataSource} from "typeorm";
import {createApp, http, HttpClient, resetDatabase} from "./helpers/app";
import {authHeader, createImportLog, findLog, jpegBytes, registerAndLogin} from "./helpers/fixtures";
import {MockResponse, MockServer, startMockServer} from "./helpers/mock-server";

function deepseekBody(parsed: unknown): string {
    return JSON.stringify({
        choices: [{message: {content: JSON.stringify(parsed)}}],
        usage: {prompt_tokens: 10, completion_tokens: 8},
    });
}

function multipartBody(filename: string, contentType: string, bytes: Buffer): Buffer {
    const boundary = "----bookkeeping-test-boundary";
    return Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`),
        Buffer.from(`Content-Type: ${contentType}\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
}

describe("receipts & AI", () => {
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

    async function mockServer(handler: (request: Parameters<Parameters<typeof startMockServer>[0]>[0]) => MockResponse) {
        const server = await startMockServer(handler);
        servers.push(server);
        process.env.DEEPSEEK_BASE_URL = server.uri;
        process.env.DEEPSEEK_API_KEY = "test-key";
        process.env.DEEPSEEK_MODEL = "deepseek-flash";
        process.env.LIHKG_ALLOWED_HOSTS = "127.0.0.1";
        process.env.LIHKG_UPLOAD_URL = `${server.uri}/upload`;
        return server;
    }

    it("upload sends lihkg origin and returns digest", async () => {
        const server = await mockServer(request =>
            request.path === "/upload" && request.method === "POST"
                ? {
                      status: 200,
                      headers: {"content-type": "application/json"},
                      body: JSON.stringify({url: "https://img.eservice-hk.net/a.jpg"}),
                  }
                : {status: 404}
        );

        const fixture = await registerAndLogin(client);
        const jpeg = jpegBytes();
        const body = multipartBody("receipt.jpg", "image/jpeg", jpeg);
        const response = await client.post("/api/v1/receipts/upload").set(authHeader(fixture.token)).set("Content-Type", "multipart/form-data; boundary=----bookkeeping-test-boundary").send(body);

        expect(response.status).toBe(201);
        expect(response.body.data.url).toMatch(/a\.jpg$/);
        expect(response.body.data.sha256).toHaveLength(64);
        expect(response.body.data.sha256).toBe(sha256Hex(jpeg));

        const upload = server.requests.find(request => request.path === "/upload");
        expect(upload?.headers.origin).toBe("https://lihkg.com");
    });

    it("upload rejects non-image file", async () => {
        await mockServer(() => ({status: 404}));
        const fixture = await registerAndLogin(client);
        const body = multipartBody("receipt.exe", "application/octet-stream", Buffer.from("MZxxxx"));

        const response = await client.post("/api/v1/receipts/upload").set(authHeader(fixture.token)).set("Content-Type", "multipart/form-data; boundary=----bookkeeping-test-boundary").send(body);
        expect(response.status).toBe(422);
    });

    it("parse caches and rejects non-whitelisted hosts", async () => {
        const jpeg = jpegBytes();
        const server = await mockServer(request => {
            if (request.method === "GET" && request.path === "/receipt.jpg") {
                return {status: 200, headers: {"content-type": "image/jpeg"}, body: jpeg};
            }
            if (request.method === "POST" && request.path === "/chat/completions") {
                return {
                    status: 200,
                    headers: {"content-type": "application/json"},
                    body: deepseekBody({
                        amount_cents: 1234,
                        kind: "expense",
                        occurred_at: "2026-09-14T10:00:00+08:00",
                        confidence: 0.9,
                    }),
                };
            }
            return {status: 404};
        });

        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);
        const imageUrl = `${server.uri}/receipt.jpg`;

        for (let index = 0; index < 2; index += 1) {
            const response = await client.post("/api/v1/ai/parse").set(headers).send({image_url: imageUrl});
            expect(response.status).toBe(200);
        }

        expect(server.countRequests("/chat/completions")).toBe(1);

        const ssrf = await client.post("/api/v1/ai/parse").set(headers).send({image_url: "http://169.254.169.254/private"});
        expect(ssrf.status).toBe(400);
    });

    it("parse ignores a stale cache entry", async () => {
        const jpeg = jpegBytes();
        const server = await mockServer(request => {
            if (request.method === "GET" && request.path === "/stale.jpg") {
                return {status: 200, headers: {"content-type": "image/jpeg"}, body: jpeg};
            }
            if (request.method === "POST" && request.path === "/chat/completions") {
                return {
                    status: 200,
                    headers: {"content-type": "application/json"},
                    body: deepseekBody({
                        amount_cents: 4500,
                        kind: "expense",
                        occurred_at: "2026-02-21T15:45:00",
                        category_hint: "飲食",
                        confidence: 0.9,
                    }),
                };
            }
            return {status: 404};
        });

        const fixture = await registerAndLogin(client);
        const stale = await createImportLog(dataSource, fixture.userId, sha256Hex(jpeg), {
            amount_cents: 1,
            kind: "expense",
            category_hint: null,
        });

        const response = await client
            .post("/api/v1/ai/parse")
            .set(authHeader(fixture.token))
            .send({image_url: `${server.uri}/stale.jpg`});
        expect(response.status).toBe(200);
        expect(response.body.data.id).not.toBe(stale.id);
        expect(response.body.data.parsed.amount_cents).toBe(4500);
    });

    it("parse handles multibyte text", async () => {
        const jpeg = jpegBytes();
        const server = await mockServer(request => {
            if (request.method === "GET" && request.path === "/cn.jpg") {
                return {status: 200, headers: {"content-type": "image/jpeg"}, body: jpeg};
            }
            if (request.method === "POST" && request.path === "/chat/completions") {
                return {
                    status: 200,
                    headers: {"content-type": "application/json"},
                    body: deepseekBody({
                        amount_cents: 1234,
                        kind: "expense",
                        occurred_at: "2026-09-14T10:00:00+08:00",
                        merchant_name: "茶餐廳",
                        note: "午餐",
                        category_hint: "飲食",
                        confidence: 0.9,
                    }),
                };
            }
            return {status: 404};
        });

        const fixture = await registerAndLogin(client);
        const response = await client
            .post("/api/v1/ai/parse")
            .set(authHeader(fixture.token))
            .send({image_url: `${server.uri}/cn.jpg`});
        expect(response.status).toBe(200);
        expect(response.body.data.parsed.merchant_name).toBe("茶餐廳");
    });

    it("parse matches category hint against user categories", async () => {
        const jpeg = jpegBytes();
        const server = await mockServer(request => {
            if (request.method === "GET" && request.path === "/cat.jpg") {
                return {status: 200, headers: {"content-type": "image/jpeg"}, body: jpeg};
            }
            if (request.method === "POST" && request.path === "/chat/completions") {
                return {
                    status: 200,
                    headers: {"content-type": "application/json"},
                    body: deepseekBody({
                        amount_cents: 1234,
                        kind: "expense",
                        occurred_at: "2026-09-14T10:00:00+08:00",
                        category_hint: "飲食",
                        confidence: 0.9,
                    }),
                };
            }
            return {status: 404};
        });

        const fixture = await registerAndLogin(client);
        const response = await client
            .post("/api/v1/ai/parse")
            .set(authHeader(fixture.token))
            .send({image_url: `${server.uri}/cat.jpg`});
        expect(response.body.data.parsed.category_hint).toBe("飲食");
        expect(response.body.data.suggested_category_id).toBe(fixture.expenseCategoryId);

        const deepseek = server.requests.find(request => request.path === "/chat/completions");
        const requestBody = JSON.parse(deepseek!.body.toString("utf8"));
        const prompt = requestBody.messages[0].content[0].text as string;
        expect(prompt).toContain('EXPENSE categories: ["飲食"');
    });

    it("parse forces unmatched or wrong kind hints to null", async () => {
        const jpeg = jpegBytes();
        const server = await mockServer(request => {
            if (request.method === "GET" && request.path === "/nomatch.jpg") {
                return {status: 200, headers: {"content-type": "image/jpeg"}, body: jpeg};
            }
            if (request.method === "POST" && request.path === "/chat/completions") {
                const body = JSON.parse(request.body.toString("utf8"));
                const prompt = body.messages[0].content[0].text as string;
                return {
                    status: 200,
                    headers: {"content-type": "application/json"},
                    body: deepseekBody({
                        amount_cents: 1234,
                        kind: "expense",
                        occurred_at: "2026-09-14T10:00:00+08:00",
                        category_hint: prompt.includes("Groceries") ? "groceries" : "餐飲",
                        confidence: 0.9,
                    }),
                };
            }
            return {status: 404};
        });

        const fixture = await registerAndLogin(client);
        const response = await client
            .post("/api/v1/ai/parse")
            .set(authHeader(fixture.token))
            .send({image_url: `${server.uri}/nomatch.jpg`});
        expect(response.body.data.parsed.category_hint).toBeNull();
        expect(response.body.data.suggested_category_id).toBeNull();
    });

    it("confirm creates an ai transaction", async () => {
        const fixture = await registerAndLogin(client);
        const log = await createImportLog(dataSource, fixture.userId, "a".repeat(64), {
            amount_cents: 500,
            kind: "expense",
            occurred_at: "2026-09-14T10:00:00+08:00",
        });

        const response = await client.post("/api/v1/ai/confirm").set(authHeader(fixture.token)).send({
            ai_import_log_id: log.id,
            account_id: fixture.accountId,
            amount_cents: 500,
            kind: "expense",
            occurred_at: "2026-09-14T10:00:00+08:00",
        });
        expect(response.status).toBe(201);
        expect(response.body.data.source).toBe("ai");
        expect(response.body.data.image_urls[0]).toBe("https://img.eservice-hk.net/a.jpg");

        const updated = await findLog(dataSource, log.id);
        expect(updated.transaction_id).toBe(response.body.data.id);
    });

    it("interpret parses a natural-language sentence into a text preview", async () => {
        const server = await mockServer(request =>
            request.method === "POST" && request.path === "/chat/completions"
                ? {
                      status: 200,
                      headers: {"content-type": "application/json"},
                      body: deepseekBody({transactions: [{amount_cents: 4500, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00", merchant_name: "茶餐廳", confidence: 0.9}]}),
                  }
                : {status: 404}
        );

        const fixture = await registerAndLogin(client);
        const response = await client.post("/api/v1/ai/interpret").set(authHeader(fixture.token)).send({text: "尋日茶餐廳 45 蚊"});

        expect(response.status).toBe(200);
        expect(response.body.data.source).toBe("text");
        expect(response.body.data.image_urls).toEqual([]);
        expect(response.body.data.parsed.amount_cents).toBe(4500);
        expect(response.body.data.parsed_items).toHaveLength(1);
        expect(response.body.data.parsed_items[0].parsed.amount_cents).toBe(4500);

        const cached = await client.post("/api/v1/ai/interpret").set(authHeader(fixture.token)).send({text: "尋日茶餐廳 45 蚊"});
        expect(cached.body.data.id).toBe(response.body.data.id);
        expect(cached.body.data.parsed_items).toHaveLength(1);
        expect(server.countRequests("/chat/completions")).toBe(1);
    });

    it("interpret splits a multi-transaction sentence into one item per transaction", async () => {
        await mockServer(request =>
            request.method === "POST" && request.path === "/chat/completions"
                ? {
                      status: 200,
                      headers: {"content-type": "application/json"},
                      body: deepseekBody({
                          transactions: [
                              {amount_cents: 3000, kind: "expense", occurred_at: "2026-09-14T08:00:00+08:00", merchant_name: "茶餐廳", confidence: 0.9},
                              {amount_cents: 5000, kind: "expense", occurred_at: "2026-09-14T12:00:00+08:00", confidence: 0.9},
                              {amount_cents: 2000, kind: "expense", occurred_at: "2026-09-14T18:00:00+08:00", confidence: 0.9},
                          ],
                      }),
                  }
                : {status: 404}
        );

        const fixture = await registerAndLogin(client);
        const response = await client.post("/api/v1/ai/interpret").set(authHeader(fixture.token)).send({text: "早餐 30 午餐 50 車費 20"});

        expect(response.status).toBe(200);
        expect(response.body.data.parsed.amount_cents).toBe(3000);
        expect(response.body.data.parsed_items.map((item: {parsed: {amount_cents: number}}) => item.parsed.amount_cents)).toEqual([3000, 5000, 2000]);
    });

    it("interpret rejects blank or oversized text", async () => {
        await mockServer(() => ({status: 404}));
        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);

        const blank = await client.post("/api/v1/ai/interpret").set(headers).send({text: "   "});
        expect(blank.status).toBe(422);

        const tooLong = await client
            .post("/api/v1/ai/interpret")
            .set(headers)
            .send({text: "a".repeat(501)});
        expect(tooLong.status).toBe(422);
    });

    it("interpret maps a DeepSeek failure to a 502", async () => {
        await mockServer(request => (request.path === "/chat/completions" ? {status: 500} : {status: 404}));
        const fixture = await registerAndLogin(client);

        const response = await client.post("/api/v1/ai/interpret").set(authHeader(fixture.token)).send({text: "午餐 45 蚊"});
        expect(response.status).toBe(502);
    });

    it("confirm materialises a transaction from a natural-language preview", async () => {
        const server = await mockServer(request =>
            request.method === "POST" && request.path === "/chat/completions"
                ? {
                      status: 200,
                      headers: {"content-type": "application/json"},
                      body: deepseekBody({amount_cents: 4500, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00", confidence: 0.9}),
                  }
                : {status: 404}
        );

        const fixture = await registerAndLogin(client);
        const preview = await client.post("/api/v1/ai/interpret").set(authHeader(fixture.token)).send({text: "午餐 45 蚊"});
        expect(preview.status).toBe(200);

        const response = await client.post("/api/v1/ai/confirm").set(authHeader(fixture.token)).send({
            ai_import_log_id: preview.body.data.id,
            account_id: fixture.accountId,
            amount_cents: 4500,
            kind: "expense",
            occurred_at: "2026-09-14T10:00:00+08:00",
        });

        expect(response.status).toBe(201);
        expect(response.body.data.source).toBe("ai");
        expect(response.body.data.image_urls).toEqual([]);

        const stored = server.requests.find(request => request.path === "/chat/completions");
        expect(stored).toBeDefined();
    });
});
