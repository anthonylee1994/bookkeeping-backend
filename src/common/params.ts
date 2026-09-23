import {ApiError} from "./errors";
import * as time from "./time";

export type JsonObject = Record<string, unknown>;

/** Reads a string field; `null` when absent or not a JSON string. */
export function stringField(body: JsonObject, key: string): string | null {
    const value = body[key];
    return typeof value === "string" ? value : null;
}

/** Whether the key is present at all, even when its value is `null`. */
export function touched(body: JsonObject, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(body, key);
}

/** Parses an enum field written as a string. */
export function parseEnumField(body: JsonObject, key: string, parser: (value: string) => number | null): number | null {
    const value = body[key];
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === "string") {
        const parsed = parser(value);
        if (parsed === null) {
            throw ApiError.invalidValue();
        }
        return parsed;
    }
    throw ApiError.invalidValue();
}

/** Parses an integer field that may arrive as a JSON number or numeric string. */
export function parseI32Field(body: JsonObject, key: string): number | null {
    const value = body[key];
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === "number") {
        if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
            throw ApiError.invalidValue();
        }
        if (value < -2_147_483_648 || value > 2_147_483_647) {
            throw ApiError.invalidValue();
        }
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number.parseInt(value.trim(), 10);
        if (Number.isNaN(parsed) || !/^[+-]?\d+$/.test(value.trim())) {
            throw ApiError.invalidValue();
        }
        return parsed;
    }
    throw ApiError.invalidValue();
}

/** Parses a datetime string field; absent/null stays `null`. */
export function parseDatetimeField(body: JsonObject, key: string): Date | null {
    const value = body[key];
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === "string") {
        const parsed = time.parseDatetime(value);
        if (!parsed) {
            throw ApiError.invalidValue();
        }
        return parsed;
    }
    throw ApiError.invalidValue();
}
