import type {RawBodyRequest} from "@nestjs/common";
import type {Request, Response} from "express";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {AiController} from "../src/ai/ai.controller";
import {DeepSeekError} from "../src/ai/deepseek.service";
import {Account} from "../src/database/entities/account.entity";
import {AiImportLog} from "../src/database/entities/ai-import-log.entity";
import {Category} from "../src/database/entities/category.entity";
import {Merchant} from "../src/database/entities/merchant.entity";
import {IdempotencyService} from "../src/idempotency/idempotency.service";
import {TransactionsService} from "../src/transactions/transactions.service";
import {categoryFixture, importLogFixture, MockRepo, MockResponse, mockRepo, mockResponse, repo, transactionFixture, userFixture} from "./helpers/unit";

const USER = "user-1";

function imageResponse(): {ok: boolean; headers: {get: () => string}; arrayBuffer: () => Promise<ArrayBuffer>} {
    return {
        ok: true,
        headers: {get: () => "image/jpeg"},
        arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer,
    };
}

function rawRequest(body: unknown): RawBodyRequest<Request> {
    return {rawBody: Buffer.from(JSON.stringify(body)), headers: {}} as unknown as RawBodyRequest<Request>;
}

describe("AiController (unit)", () => {
    let importLogs: MockRepo;
    let accounts: MockRepo;
    let categories: MockRepo;
    let merchants: MockRepo;
    let deepseek: {call: ReturnType<typeof vi.fn>; callInterpret: ReturnType<typeof vi.fn>; callQuery: ReturnType<typeof vi.fn>};
    let transactions: {createValidated: ReturnType<typeof vi.fn>};
    let idempotency: {wrap: ReturnType<typeof vi.fn>};
    let controller: AiController;

    beforeEach(() => {
        importLogs = mockRepo();
        accounts = mockRepo();
        categories = mockRepo();
        merchants = mockRepo();
        deepseek = {call: vi.fn(), callInterpret: vi.fn(), callQuery: vi.fn()};
        transactions = {createValidated: vi.fn()};
        idempotency = {wrap: vi.fn().mockImplementation(async (options: {run: () => Promise<unknown>}) => options.run())};
        accounts.find.mockResolvedValue([]);
        categories.find.mockResolvedValue([]);
        merchants.find.mockResolvedValue([]);
        controller = new AiController(
            repo<AiImportLog>(importLogs),
            repo<Account>(accounts),
            repo<Category>(categories),
            repo<Merchant>(merchants),
            deepseek as never,
            transactions as unknown as TransactionsService,
            idempotency as unknown as IdempotencyService
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("parse requires image_url", async () => {
        await expect(controller.parse(userFixture({id: USER}), {})).rejects.toMatchObject({status: 422});
    });

    it("parse rejects a non-whitelisted host", async () => {
        await expect(controller.parse(userFixture({id: USER}), {image_url: "http://169.254.169.254/private"})).rejects.toMatchObject({status: 400, code: "validation_error"});
    });

    it("parse returns a fresh cache hit without calling DeepSeek", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse()));
        importLogs.findOne.mockResolvedValue(importLogFixture({id: "log-1", status: 1, parsed_json: JSON.stringify({amount_cents: 1234, kind: "expense"})}));
        categories.find.mockResolvedValue([categoryFixture({id: "c1", kind: 1, name: "飲食"})]);

        const result = (await controller.parse(userFixture({id: USER}), {image_url: "http://127.0.0.1/receipt.jpg"})) as {data: Record<string, unknown>};

        expect(result.data).toMatchObject({id: "log-1", status: "success"});
        expect(deepseek.call).not.toHaveBeenCalled();
    });

    it("parse calls DeepSeek and stores the log on a cache miss", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse()));
        importLogs.findOne.mockResolvedValue(null);
        categories.find.mockResolvedValue([categoryFixture({id: "c1", kind: 1, name: "飲食"})]);
        deepseek.call.mockResolvedValue({
            parsed: {amount_cents: 500, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00"},
            raw_response: "{}",
            error_message: null,
            tokens_in: 10,
            tokens_out: 5,
            latency_ms: 20,
            status: 1,
        });

        const result = (await controller.parse(userFixture({id: USER}), {image_url: "http://127.0.0.1/receipt.jpg"})) as {data: Record<string, unknown>};

        expect(deepseek.call).toHaveBeenCalledWith(expect.any(String), "image/jpeg", [{kind: 1, name: "飲食"}]);
        const saved = importLogs.save.mock.calls[0]?.[0] as AiImportLog;
        expect(saved).toMatchObject({provider: "deepseek", status: 1, tokens_in: 10});
        expect(result.data.parsed).toMatchObject({amount_cents: 500});
    });

    it("parse maps a DeepSeek failure to a 502", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse()));
        importLogs.findOne.mockResolvedValue(null);
        categories.find.mockResolvedValue([]);
        deepseek.call.mockRejectedValue(new DeepSeekError("upstream down"));

        await expect(controller.parse(userFixture({id: USER}), {image_url: "http://127.0.0.1/receipt.jpg"})).rejects.toMatchObject({status: 502, code: "upstream_error"});
    });

    it("interpret requires text", async () => {
        await expect(controller.interpret(userFixture({id: USER}), {})).rejects.toMatchObject({status: 422});
    });

    it("interpret rejects text over the limit", async () => {
        await expect(controller.interpret(userFixture({id: USER}), {text: "a".repeat(501)})).rejects.toMatchObject({status: 422, code: "validation_error"});
    });

    it("interpret calls DeepSeek and stores a text-sourced log", async () => {
        importLogs.findOne.mockResolvedValue(null);
        categories.find.mockResolvedValue([categoryFixture({id: "c1", kind: 1, name: "飲食"})]);
        deepseek.callInterpret.mockResolvedValue({
            parsed: [{amount_cents: 500, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00", category_hint: "飲食"}],
            raw_response: "{}",
            error_message: null,
            tokens_in: 10,
            tokens_out: 5,
            latency_ms: 20,
            status: 1,
        });

        const result = (await controller.interpret(userFixture({id: USER}), {text: " 午餐 5 蚊 "})) as {data: Record<string, unknown>};

        expect(deepseek.callInterpret).toHaveBeenCalledWith("午餐 5 蚊", [{kind: 1, name: "飲食"}]);
        const saved = importLogs.save.mock.calls[0]?.[0] as AiImportLog;
        expect(saved).toMatchObject({source: "text", image_urls: "[]", status: 1});
        expect(result.data).toMatchObject({source: "text", suggested_category_id: "c1"});
        expect(result.data.parsed).toMatchObject({amount_cents: 500});
        expect(result.data.parsed_items).toEqual([expect.objectContaining({suggested_category_id: "c1", parsed: expect.objectContaining({amount_cents: 500})})]);
    });

    it("interpret keeps every parsed transaction in parsed_items", async () => {
        importLogs.findOne.mockResolvedValue(null);
        categories.find.mockResolvedValue([]);
        deepseek.callInterpret.mockResolvedValue({
            parsed: [
                {amount_cents: 3000, kind: "expense", occurred_at: "2026-09-14T08:00:00+08:00", category_hint: null},
                {amount_cents: 5000, kind: "expense", occurred_at: "2026-09-14T12:00:00+08:00", category_hint: null},
            ],
            raw_response: "{}",
            error_message: null,
            tokens_in: 10,
            tokens_out: 5,
            latency_ms: 20,
            status: 1,
        });

        const result = (await controller.interpret(userFixture({id: USER}), {text: "早餐 30 午餐 50"})) as {data: Record<string, unknown>};

        expect(result.data.parsed).toMatchObject({amount_cents: 3000});
        expect(result.data.parsed_items).toHaveLength(2);
        expect(JSON.parse((importLogs.save.mock.calls[0]?.[0] as AiImportLog).parsed_json ?? "[]")).toHaveLength(2);
    });

    it("interpret stores no parsed_json when no transaction is extracted", async () => {
        importLogs.findOne.mockResolvedValue(null);
        categories.find.mockResolvedValue([]);
        deepseek.callInterpret.mockResolvedValue({
            parsed: null,
            raw_response: "{}",
            error_message: "no transaction",
            tokens_in: 10,
            tokens_out: 5,
            latency_ms: 20,
            status: 3,
        });

        const result = (await controller.interpret(userFixture({id: USER}), {text: "今日天氣好"})) as {data: Record<string, unknown>};

        expect(result.data.status).toBe("partial");
        expect(result.data.parsed).toBeNull();
        expect(result.data.parsed_items).toEqual([]);
        expect((importLogs.save.mock.calls[0]?.[0] as AiImportLog).parsed_json).toBeNull();
    });

    it("interpret returns a fresh cache hit without calling DeepSeek", async () => {
        importLogs.findOne.mockResolvedValue(importLogFixture({id: "log-text", source: "text", status: 1, parsed_json: JSON.stringify({amount_cents: 1234, kind: "expense"})}));
        categories.find.mockResolvedValue([]);

        const result = (await controller.interpret(userFixture({id: USER}), {text: "x"})) as {data: Record<string, unknown>};

        expect(result.data).toMatchObject({id: "log-text", source: "text"});
        expect(result.data.parsed_items).toEqual([expect.objectContaining({parsed: expect.objectContaining({amount_cents: 1234})})]);
        expect(deepseek.callInterpret).not.toHaveBeenCalled();
    });

    it("interpret maps a DeepSeek failure to a 502", async () => {
        importLogs.findOne.mockResolvedValue(null);
        categories.find.mockResolvedValue([]);
        deepseek.callInterpret.mockRejectedValue(new DeepSeekError("upstream down"));

        await expect(controller.interpret(userFixture({id: USER}), {text: "午餐"})).rejects.toMatchObject({status: 502, code: "upstream_error"});
    });

    it("query resolves names to ids and falls unknown merchants back to a keyword", async () => {
        accounts.find.mockResolvedValue([{id: "a1", name: "現金"}]);
        categories.find.mockResolvedValue([{id: "c1", kind: 1, name: "飲食"}]);
        merchants.find.mockResolvedValue([{id: "m1", name: "Starbucks"}]);
        deepseek.callQuery.mockResolvedValue({
            query: {from: "2026-08-01", to: "2026-08-31", kind: "expense", account_name: "現金", category_name: "飲食", merchant_name: "譚仔"},
            explanation: "上月現金飲食",
            raw_response: "{}",
            error_message: null,
            tokens_in: 10,
            tokens_out: 5,
            latency_ms: 20,
            status: 1,
        });

        const result = (await controller.query(userFixture({id: USER}), {text: " 上月 "})) as {data: Record<string, unknown>};

        expect(deepseek.callQuery).toHaveBeenCalledWith("上月", {accounts: ["現金"], categories: [{kind: 1, name: "飲食"}], merchants: ["Starbucks"]});
        expect(result.data).toMatchObject({status: "success", explanation: "上月現金飲食"});
        expect(result.data.filters).toEqual({from: "2026-08-01", to: "2026-08-31", kind: "expense", account_id: "a1", category_id: "c1", q: "譚仔"});
    });

    it("query returns partial when no usable filter is translated", async () => {
        deepseek.callQuery.mockResolvedValue({query: null, explanation: "唔係搵交易", raw_response: "{}", error_message: "no filter", tokens_in: 1, tokens_out: 1, latency_ms: 5, status: 3});

        const result = (await controller.query(userFixture({id: USER}), {text: "今日天氣"})) as {data: Record<string, unknown>};

        expect(result.data).toMatchObject({status: "partial", filters: null});
    });

    it("query requires text and maps a DeepSeek failure to a 502", async () => {
        await expect(controller.query(userFixture({id: USER}), {})).rejects.toMatchObject({status: 422});

        deepseek.callQuery.mockRejectedValue(new DeepSeekError("upstream down"));
        await expect(controller.query(userFixture({id: USER}), {text: "午餐"})).rejects.toMatchObject({status: 502, code: "upstream_error"});
    });

    it("confirm requires an import log id", async () => {
        await expect(controller.confirm(userFixture({id: USER}), rawRequest({}), mockResponse() as unknown as Response)).rejects.toMatchObject({status: 422});
    });

    it("confirm 404s for a log owned by someone else", async () => {
        importLogs.findOne.mockResolvedValue(null);
        await expect(controller.confirm(userFixture({id: USER}), rawRequest({ai_import_log_id: "log-1"}), mockResponse() as unknown as Response)).rejects.toMatchObject({status: 404});
    });

    it("confirm creates an ai transaction and links the log", async () => {
        importLogs.findOne.mockResolvedValue(importLogFixture({id: "log-1", image_urls: JSON.stringify(["https://img.eservice-hk.net/a.jpg"])}));
        transactions.createValidated.mockResolvedValue(transactionFixture({id: "t1", source: 2}));
        const response: MockResponse = mockResponse();

        await controller.confirm(
            userFixture({id: USER}),
            rawRequest({ai_import_log_id: "log-1", account_id: "a1", amount_cents: 500, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00"}),
            response as unknown as Response
        );

        expect(transactions.createValidated).toHaveBeenCalledWith(USER, expect.objectContaining({source: "ai", image_urls: ["https://img.eservice-hk.net/a.jpg"]}), 2);
        expect(importLogs.update).toHaveBeenCalledWith({id: "log-1"}, expect.objectContaining({transaction_id: "t1"}));
        expect(response.status).toHaveBeenCalledWith(201);
    });
});
