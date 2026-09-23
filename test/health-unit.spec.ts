import type {Response} from "express";
import {afterEach, describe, expect, it, vi} from "vitest";
import type {DataSource} from "typeorm";

import {DocsController} from "../src/docs/docs.controller";
import {HealthController} from "../src/health/health.controller";
import {MockResponse, mockResponse} from "./helpers/unit";

function responseMock(): {res: MockResponse; response: Response} {
    const res = mockResponse();
    return {res, response: res as unknown as Response};
}

describe("HealthController (unit)", () => {
    function controller(query: ReturnType<typeof vi.fn>): HealthController {
        return new HealthController({query} as unknown as DataSource);
    }

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("up is a no-op liveness probe", () => {
        expect(controller(vi.fn()).up()).toBeUndefined();
    });

    it("dbHealth reports WAL mode as healthy", async () => {
        const {res, response} = responseMock();
        await controller(vi.fn().mockResolvedValue([{journal_mode: "wal"}])).dbHealth(response);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({status: "ok", checks: {db: {status: "ok", wal: true}}});
    });

    it("dbHealth reports unhealthy for a non-WAL journal", async () => {
        const {res, response} = responseMock();
        await controller(vi.fn().mockResolvedValue([{journal_mode: "delete"}])).dbHealth(response);
        expect(res.status).toHaveBeenCalledWith(503);
    });

    it("deepseekHealth fails without an api key", async () => {
        vi.stubEnv("DEEPSEEK_API_KEY", "");
        const {res, response} = responseMock();
        await controller(vi.fn()).deepseekHealth(response);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith({status: "error", checks: {deepseek: {status: "error"}}});
    });

    it("deepseekHealth succeeds when the upstream responds", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: true, status: 200}));
        const {res, response} = responseMock();
        await controller(vi.fn()).deepseekHealth(response);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({status: "ok", checks: {deepseek: {status: "ok", code: 200}}});
    });

    it("health aggregates every check", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: true, status: 200}));
        const {res, response} = responseMock();
        await controller(vi.fn().mockResolvedValue([{journal_mode: "wal"}])).health(response);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({status: "ok", checks: {db: {status: "ok", wal: true}, deepseek: {status: "ok", code: 200}, lihkg: {status: "ok", code: 200}}});
    });

    it("health is unhealthy when any check fails", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: false, status: 503}));
        const {res, response} = responseMock();
        await controller(vi.fn().mockResolvedValue([{journal_mode: "wal"}])).health(response);
        expect(res.status).toHaveBeenCalledWith(503);
    });
});

describe("DocsController (unit)", () => {
    it("serves the OpenAPI yaml", () => {
        const res = mockResponse();
        new DocsController().spec(res as unknown as Response);
        expect(res.type).toHaveBeenCalledWith("application/yaml");
        expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Bookkeeping API"));
    });
});
