import {Injectable} from "@nestjs/common";
import {performance} from "node:perf_hooks";

import {envOr} from "../config/env";
import {allowedNumericTokens, insightPrompt, validateInsight} from "./insight";

export const PROMPT_VERSION = "v2";
export {INSIGHT_PROMPT_VERSION} from "./insight";
export const STATUS_PENDING = 0;
export const STATUS_SUCCESS = 1;
export const STATUS_FAILED = 2;
export const STATUS_PARTIAL = 3;

export class DeepSeekError extends Error {}

export interface CategoryRef {
    kind: number;
    name: string;
}

export interface Outcome {
    parsed: unknown | null;
    raw_response: string | null;
    error_message: string | null;
    tokens_in: number | null;
    tokens_out: number | null;
    latency_ms: number;
    status: number;
}

export interface InsightOutcome {
    text: string | null;
    highlights: string[];
    raw_response: string | null;
    error_message: string | null;
    tokens_in: number | null;
    tokens_out: number | null;
    latency_ms: number;
    status: number;
}

interface ChatCompletion {
    rawText: string;
    raw: Record<string, unknown>;
    tokensIn: number | null;
    tokensOut: number | null;
}

function baseUrl(): string {
    return envOr("DEEPSEEK_BASE_URL", "https://api.deepseek.com");
}

function model(): string {
    return envOr("DEEPSEEK_MODEL", "deepseek-flash");
}

function prompt(categories: CategoryRef[]): string {
    const header =
        "You extract a single transaction from a receipt image and reply with JSON only.\n" +
        "The JSON must have exactly these keys:\n" +
        "- amount_cents: integer in cents (> 0)\n" +
        '- kind: "income" or "expense"\n' +
        "- occurred_at: ISO8601 date-time string\n" +
        "- merchant_name: string or null\n" +
        "- category_hint: string or null\n" +
        "- note: string or null\n" +
        "- confidence: number between 0 and 1\n\n";

    if (categories.length === 0) {
        return `${header}There are no user-defined categories. Always set category_hint to null.`;
    }

    return (
        `${header}Category rules (follow strictly):\n` +
        "- Decide kind first, then set category_hint to one of the exact strings from that kind's list.\n" +
        '- Copy the chosen name character-for-character. Do NOT translate it, shorten it, add "(expense)"/"(income)", or invent a new name.\n' +
        '- If kind is "expense" only use the EXPENSE list; if kind is "income" only use the INCOME list.\n' +
        "- If no category fits, set category_hint to null. Returning null is always allowed and preferred over guessing.\n\n" +
        `EXPENSE categories: ${namesFor(categories, 1)}\n` +
        `INCOME categories: ${namesFor(categories, 0)}\n`
    );
}

function namesFor(categories: CategoryRef[], kind: number): string {
    const names = categories.filter(category => category.kind === kind).map(category => category.name);
    return names.length === 0 ? "[]" : JSON.stringify(names);
}

function validate(parsed: unknown): string | null {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return "parsed response is not an object";
    }
    const object = parsed as Record<string, unknown>;

    const amount = object.amount_cents;
    if (typeof amount !== "number" || !Number.isInteger(amount)) {
        return "amount_cents must be an integer";
    }
    if (amount < 1) {
        return "amount_cents must be >= 1";
    }

    if (object.kind !== "income" && object.kind !== "expense") {
        return "kind must be income or expense";
    }

    if (typeof object.occurred_at !== "string") {
        return "occurred_at must be a string";
    }

    for (const field of ["merchant_name", "category_hint", "note"]) {
        const value = object[field];
        if (value !== undefined && value !== null && typeof value !== "string") {
            return `${field} must be a string or null`;
        }
    }

    const confidence = object.confidence;
    if (confidence !== undefined && confidence !== null) {
        if (typeof confidence !== "number") {
            return "confidence must be a number";
        }
        if (confidence < 0 || confidence > 1) {
            return "confidence must be between 0 and 1";
        }
    }

    return null;
}

function extractJsonObjects(text: string): unknown[] {
    const objects: unknown[] = [];
    let depth = 0;
    let start: number | null = null;
    let inString = false;
    let escaped = false;
    const chars = [...text];

    for (let index = 0; index < chars.length; index += 1) {
        const ch = chars[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            if (depth > 0) {
                inString = true;
            }
        } else if (ch === "{") {
            if (depth === 0) {
                start = index;
            }
            depth += 1;
        } else if (ch === "}") {
            if (depth === 0) {
                continue;
            }
            depth -= 1;
            if (depth === 0 && start !== null) {
                const slice = chars.slice(start, index + 1).join("");
                try {
                    objects.push(JSON.parse(slice));
                } catch {
                    // ignore non-JSON candidate
                }
                start = null;
            }
        }
    }

    return objects;
}

function extractJsonObject(content: string, requiredKey: string): unknown | null {
    const candidates = extractJsonObjects(content);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate) && requiredKey in candidate) {
            return candidate;
        }
    }
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

function messageContent(raw: Record<string, unknown>): string {
    const choices = Array.isArray(raw.choices) ? raw.choices : [];
    const first = (choices[0] ?? {}) as Record<string, unknown>;
    const message = (first.message ?? {}) as Record<string, unknown>;
    return typeof message.content === "string" ? message.content : "";
}

@Injectable()
export class DeepseekService {
    async call(imageBase64: string, contentType: string, categories: CategoryRef[]): Promise<Outcome> {
        const started = performance.now();
        const key = process.env.DEEPSEEK_API_KEY;
        if (!key) {
            throw new DeepSeekError("missing DEEPSEEK_API_KEY");
        }

        const body = {
            model: model(),
            messages: [
                {
                    role: "user",
                    content: [
                        {type: "text", text: prompt(categories)},
                        {type: "image_url", image_url: {url: `data:${contentType};base64,${imageBase64}`}},
                    ],
                },
            ],
            response_format: {type: "json_object"},
        };

        const {rawText, raw, tokensIn, tokensOut} = await this.postChat(key, body);
        const latencyMs = Math.min(Math.round(performance.now() - started), 2_147_483_647);

        let parsed = extractJsonObject(messageContent(raw), "amount_cents");
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            const map = parsed as Record<string, unknown>;
            if (map.type === "json_object") {
                delete map.type;
            }
        }

        if (parsed === null) {
            return {
                parsed: null,
                raw_response: rawText,
                error_message: "DeepSeek response did not contain a JSON object",
                tokens_in: tokensIn,
                tokens_out: tokensOut,
                latency_ms: latencyMs,
                status: STATUS_PARTIAL,
            };
        }

        const error = validate(parsed);
        return {
            parsed,
            raw_response: rawText,
            error_message: error,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            latency_ms: latencyMs,
            status: error === null ? STATUS_SUCCESS : STATUS_PARTIAL,
        };
    }

    /**
     * Generates a natural-language period insight from an already-computed
     * fact sheet. Never introduces numbers: the output is rejected when it
     * mentions a value that is not in the fact sheet.
     */
    async callInsight(factSheet: string): Promise<InsightOutcome> {
        const started = performance.now();
        const key = process.env.DEEPSEEK_API_KEY;
        if (!key) {
            throw new DeepSeekError("missing DEEPSEEK_API_KEY");
        }

        const allowed = allowedNumericTokens(factSheet);
        const body = {
            model: model(),
            messages: [{role: "user", content: insightPrompt(factSheet)}],
            response_format: {type: "json_object"},
            temperature: 0.2,
        };

        const {rawText, raw, tokensIn, tokensOut} = await this.postChat(key, body);
        const latencyMs = Math.min(Math.round(performance.now() - started), 2_147_483_647);

        const parsed = extractJsonObject(messageContent(raw), "summary");
        if (parsed === null) {
            return {
                text: null,
                highlights: [],
                raw_response: rawText,
                error_message: "DeepSeek response did not contain a JSON object",
                tokens_in: tokensIn,
                tokens_out: tokensOut,
                latency_ms: latencyMs,
                status: STATUS_PARTIAL,
            };
        }

        const validated = validateInsight(parsed, allowed);
        if ("error" in validated) {
            return {
                text: null,
                highlights: [],
                raw_response: rawText,
                error_message: validated.error,
                tokens_in: tokensIn,
                tokens_out: tokensOut,
                latency_ms: latencyMs,
                status: STATUS_PARTIAL,
            };
        }

        return {
            text: validated.insight.text,
            highlights: validated.insight.highlights,
            raw_response: rawText,
            error_message: null,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            latency_ms: latencyMs,
            status: STATUS_SUCCESS,
        };
    }

    private async postChat(key: string, body: unknown): Promise<ChatCompletion> {
        let response: Response;
        try {
            response = await fetch(`${baseUrl().replace(/\/+$/, "")}/chat/completions`, {
                method: "POST",
                headers: {Authorization: `Bearer ${key}`, "Content-Type": "application/json"},
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(30_000),
            });
        } catch (error) {
            throw new DeepSeekError(String(error));
        }

        if (!response.ok) {
            throw new DeepSeekError(`DeepSeek returned ${response.status}`);
        }

        const rawText = await response.text();
        let raw: Record<string, unknown>;
        try {
            raw = JSON.parse(rawText) as Record<string, unknown>;
        } catch (error) {
            throw new DeepSeekError(`invalid DeepSeek JSON: ${String(error)}`);
        }

        const usage = (raw.usage ?? {}) as Record<string, unknown>;
        return {
            rawText,
            raw,
            tokensIn: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
            tokensOut: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
        };
    }
}
