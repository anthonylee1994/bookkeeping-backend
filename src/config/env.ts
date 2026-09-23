/**
 * Environment accessors mirroring the loco.rs helper semantics.
 */

export function env(name: string, fallback?: string): string | undefined {
    const value = process.env[name];
    if (value === undefined) {
        return fallback;
    }
    return value;
}

export function envOr(name: string, fallback: string): string {
    const value = process.env[name];
    return value === undefined || value === "" ? fallback : value;
}

export function envInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined) {
        return fallback;
    }
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

export function envBool(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined) {
        return fallback;
    }
    return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function envList(name: string): string[] {
    return envOr(name, "")
        .split(",")
        .map(value => value.trim())
        .filter(value => value !== "");
}

export function isTest(): boolean {
    return process.env.NODE_ENV === "test";
}
