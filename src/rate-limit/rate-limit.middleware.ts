import {Injectable, NestMiddleware} from "@nestjs/common";
import type {NextFunction, Request, Response} from "express";

import {AuthService} from "../auth/auth.service";
import {isTest} from "../config/env";
import {ApiError} from "../common/errors";

const WINDOW_MS = 60_000;

type KeyKind = "ip" | "user";

interface Rule {
    name: string;
    limit: number;
    key: KeyKind;
}

function ruleFor(method: string, path: string): Rule | null {
    const post = method === "POST";
    const patch = method === "PATCH" || method === "PUT";

    if (post && path === "/api/v1/auth/login") {
        return {name: "auth/login", limit: 5, key: "ip"};
    }
    if (patch && path === "/api/v1/me/password") {
        return {name: "auth/password", limit: 5, key: "user"};
    }
    if (post && (path === "/api/v1/ai/parse" || path === "/api/v1/ai/confirm")) {
        return {name: "ai", limit: 10, key: "user"};
    }
    if (post && path === "/api/v1/receipts/upload") {
        return {name: "upload", limit: 20, key: "user"};
    }
    return null;
}

const buckets = new Map<string, number[]>();

function clientIp(request: Request): string {
    const forwarded = request.headers["x-forwarded-for"];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof raw === "string") {
        const first = raw.split(",")[0]?.trim();
        if (first) {
            return first;
        }
    }
    const real = request.headers["x-real-ip"];
    const realValue = Array.isArray(real) ? real[0] : real;
    if (typeof realValue === "string" && realValue.trim() !== "") {
        return realValue.trim();
    }
    return "unknown";
}

function exceeded(key: string, limit: number): boolean {
    const now = Date.now();
    const entries = (buckets.get(key) ?? []).filter(at => now - at < WINDOW_MS);
    if (entries.length >= limit) {
        buckets.set(key, entries);
        return true;
    }
    entries.push(now);
    buckets.set(key, entries);
    return false;
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
    constructor(private readonly auth: AuthService) {}

    use(request: Request, response: Response, next: NextFunction): void {
        if (isTest()) {
            next();
            return;
        }

        const rule = ruleFor(request.method, request.path);
        if (!rule) {
            next();
            return;
        }

        const discriminator = rule.key === "ip" ? clientIp(request) : (this.userDiscriminator(request) ?? clientIp(request));
        if (exceeded(`${rule.name}:${discriminator}`, rule.limit)) {
            const error = ApiError.rateLimited();
            response.status(error.status).json(error.body());
            return;
        }

        next();
    }

    private userDiscriminator(request: Request): string | null {
        const header = request.headers.authorization;
        const raw = Array.isArray(header) ? header[0] : header;
        const token = this.auth.bearerToken(raw);
        return token ? this.auth.decodeTokenUnsafe(token) : null;
    }
}
