import {Controller, Get, Res} from "@nestjs/common";
import type {Response} from "express";
import {DataSource} from "typeorm";

import {Public} from "../auth/public.decorator";
import {envOr} from "../config/env";

@Public()
@Controller()
export class HealthController {
    constructor(private readonly dataSource: DataSource) {}

    @Get("up")
    up(): void {
        // Rails 8 liveness: 200 with an empty body.
    }

    @Get("health")
    async health(@Res() response: Response): Promise<void> {
        this.render(
            response,
            await this.checks({
                db: true,
                deepseek: true,
                lihkg: true,
            })
        );
    }

    @Get("health/db")
    async dbHealth(@Res() response: Response): Promise<void> {
        this.render(response, {db: await this.checkDb()});
    }

    @Get("health/deepseek")
    async deepseekHealth(@Res() response: Response): Promise<void> {
        this.render(response, {deepseek: await this.checkDeepseek()});
    }

    @Get("health/lihkg")
    async lihkgHealth(@Res() response: Response): Promise<void> {
        this.render(response, {lihkg: await this.checkLihkg()});
    }

    private async checks(which: {db?: boolean; deepseek?: boolean; lihkg?: boolean}): Promise<Record<string, unknown>> {
        const checks: Record<string, unknown> = {};
        if (which.db) checks.db = await this.checkDb();
        if (which.deepseek) checks.deepseek = await this.checkDeepseek();
        if (which.lihkg) checks.lihkg = await this.checkLihkg();
        return checks;
    }

    private render(response: Response, checks: Record<string, unknown>): void {
        const healthy = Object.values(checks).every(check => (check as {status?: string}).status === "ok");
        response.status(healthy ? 200 : 503).json({
            status: healthy ? "ok" : "error",
            checks,
        });
    }

    private async checkDb(): Promise<Record<string, unknown>> {
        try {
            const rows = (await this.dataSource.query("PRAGMA journal_mode")) as Array<Record<string, unknown>>;
            const mode = typeof rows[0]?.journal_mode === "string" ? (rows[0].journal_mode as string) : "";
            const wal = mode.toLowerCase() === "wal";
            return {status: wal ? "ok" : "error", wal};
        } catch {
            return {status: "error", wal: false};
        }
    }

    private async checkDeepseek(): Promise<Record<string, unknown>> {
        const base = envOr("DEEPSEEK_BASE_URL", "https://api.deepseek.com");
        const key = process.env.DEEPSEEK_API_KEY;
        if (!key) {
            return {status: "error"};
        }
        try {
            const response = await fetch(`${base.replace(/\/+$/, "")}/models`, {
                headers: {Authorization: `Bearer ${key}`},
                signal: AbortSignal.timeout(5_000),
            });
            return {status: response.ok ? "ok" : "error", code: response.status};
        } catch {
            return {status: "error"};
        }
    }

    private async checkLihkg(): Promise<Record<string, unknown>> {
        const url = envOr("LIHKG_HEALTHCHECK_URL", "") || envOr("LIHKG_UPLOAD_URL", "https://img.eservice-hk.net/api.php?version=2");
        const headers: Record<string, string> = {};
        if (url.includes("img.eservice-hk.net")) {
            headers.Origin = "https://lihkg.com";
        }
        try {
            const response = await fetch(url, {headers, signal: AbortSignal.timeout(5_000)});
            return {status: response.ok ? "ok" : "error", code: response.status};
        } catch {
            return {status: "error"};
        }
    }
}
