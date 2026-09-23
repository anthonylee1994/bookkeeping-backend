import {createHash, randomUUID} from "node:crypto";

export function newId(): string {
    return randomUUID();
}

export function sha256Hex(input: Buffer | string): string {
    return createHash("sha256").update(input).digest("hex");
}

/** Mirrors `ActiveRecord::Base.sanitize_sql_like`. */
export function sanitizeLike(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function clampPage(page: string | undefined): number {
    if (page === undefined) {
        return 1;
    }
    const parsed = Number.parseInt(page.trim(), 10);
    if (Number.isNaN(parsed)) {
        return 1;
    }
    return Math.max(parsed, 1);
}

export function clampPerPage(perPage: string | undefined): number {
    if (perPage === undefined) {
        return 25;
    }
    const parsed = Number.parseInt(perPage.trim(), 10);
    if (Number.isNaN(parsed)) {
        return 25;
    }
    return Math.min(Math.max(parsed, 1), 100);
}

export function totalPages(total: number, perPage: number): number {
    return Math.ceil(total / perPage);
}

export function jsonParse<T>(value: string, fallback: T): T {
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

export function jsonParseArray(value: string): string[] {
    const parsed = jsonParse<unknown>(value, []);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}
