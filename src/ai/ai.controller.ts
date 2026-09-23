import {Body, Controller, HttpCode, Post, RawBodyRequest, Req, Res} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import type {Request, Response as ExpressResponse} from "express";
import {MoreThan, Repository} from "typeorm";

import {CurrentUser} from "../auth/current-user.decorator";
import {ApiError} from "../common/errors";
import {envInt, envList, envOr} from "../config/env";
import {JsonObject} from "../common/params";
import * as time from "../common/time";
import {jsonParse, jsonParseArray, newId, sha256Hex} from "../common/util";
import {AiImportLog} from "../database/entities/ai-import-log.entity";
import {Category} from "../database/entities/category.entity";
import type {User} from "../database/entities/user.entity";
import {IdempotencyService} from "../idempotency/idempotency.service";
import {TransactionsService} from "../transactions/transactions.service";
import {aiPayload, transactionPayloadWithNet} from "../views/serializers";
import {DeepseekService, DeepSeekError, PROMPT_VERSION, STATUS_SUCCESS} from "./deepseek.service";

interface CategoryInfo {
    id: string;
    kind: number;
    name: string;
}

function kindKey(kind: number): string {
    return kind === 0 ? "income" : "expense";
}

function parseSignature(categoryInfos: CategoryInfo[]): string {
    const keys = categoryInfos.map(category => `${kindKey(category.kind)}:${category.name}`).sort();
    return sha256Hex(`${PROMPT_VERSION}\u0000${keys.join("\u0000")}`);
}

function matchCategory(parsed: Record<string, unknown>, categoryInfos: CategoryInfo[]): CategoryInfo | null {
    const hint = typeof parsed.category_hint === "string" ? parsed.category_hint.trim() : "";
    if (hint === "") {
        return null;
    }
    const kind = typeof parsed.kind === "string" ? parsed.kind : "";
    const kindValue = kind === "income" ? 0 : 1;
    return categoryInfos.find(category => category.kind === kindValue && category.name.toLowerCase() === hint.toLowerCase()) ?? null;
}

function normalizeCategoryHint(parsed: unknown, categoryInfos: CategoryInfo[]): unknown {
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return parsed;
    }
    const object = parsed as Record<string, unknown>;
    if (Object.keys(object).length === 0) {
        return parsed;
    }
    const matched = matchCategory(object, categoryInfos);
    return {...object, category_hint: matched ? matched.name : null};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Controller("api/v1/ai")
export class AiController {
    constructor(
        @InjectRepository(AiImportLog) private readonly importLogs: Repository<AiImportLog>,
        @InjectRepository(Category) private readonly categories: Repository<Category>,
        private readonly deepseek: DeepseekService,
        private readonly transactions: TransactionsService,
        private readonly idempotency: IdempotencyService
    ) {}

    private aiCacheHours(): number {
        return envInt("AI_CACHE_HOURS", 24);
    }

    private allowedHost(url: string): boolean {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return false;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return false;
        }
        const allowed = envList("LIHKG_ALLOWED_HOSTS");
        const list = allowed.length > 0 ? allowed : ["img.eservice-hk.net"];
        return list.includes(parsed.hostname);
    }

    private async loadCategoryInfos(userId: string): Promise<CategoryInfo[]> {
        const rows = await this.categories.find({
            where: {user_id: userId},
            order: {kind: "ASC", created_at: "ASC"},
        });
        return rows.map(row => ({id: row.id, kind: row.kind, name: row.name}));
    }

    private cachedPayload(log: AiImportLog, categoryInfos: CategoryInfo[]): Record<string, unknown> {
        const raw = log.parsed_json ? jsonParse<unknown>(log.parsed_json, null) : null;
        const normalizedRaw = raw === null ? null : normalizeCategoryHint(raw, categoryInfos);
        const normalized = normalizedRaw === null ? {} : normalizedRaw;
        const suggested = isPlainObject(normalized) ? (matchCategory(normalized, categoryInfos)?.id ?? null) : null;
        return aiPayload({log, parsed: normalized, suggestedCategoryId: suggested});
    }

    @Post("parse")
    @HttpCode(200)
    async parse(@CurrentUser() user: User, @Body() body: JsonObject): Promise<unknown> {
        const url = typeof body.image_url === "string" ? body.image_url : null;
        if (!url) {
            throw ApiError.parameterMissing("image_url");
        }

        if (!this.allowedHost(url)) {
            throw new ApiError(400, "validation_error", "image host is not allowed");
        }

        const {bytes, contentType} = await this.fetchImage(url);
        const sha = sha256Hex(bytes);

        const categoryInfos = await this.loadCategoryInfos(user.id);
        const signature = parseSignature(categoryInfos);

        const cutoff = time.toDbDatetime(time.addHours(time.nowLocal(), -this.aiCacheHours()));
        const cached = await this.importLogs.findOne({
            where: {
                user_id: user.id,
                image_sha256: sha,
                parse_signature: signature,
                status: STATUS_SUCCESS,
                created_at: MoreThan(cutoff),
            },
            order: {created_at: "DESC"},
        });

        if (cached) {
            return {data: this.cachedPayload(cached, categoryInfos)};
        }

        const imageBase64 = bytes.toString("base64");
        const refs = categoryInfos.map(category => ({kind: category.kind, name: category.name}));

        let outcome;
        try {
            outcome = await this.deepseek.call(imageBase64, contentType, refs);
        } catch (error) {
            if (error instanceof DeepSeekError) {
                throw ApiError.upstreamError(error.message);
            }
            throw error;
        }

        const parsed = outcome.parsed === null ? null : normalizeCategoryHint(outcome.parsed, categoryInfos);

        const now = time.toDbDatetime(time.nowLocal());
        const log = await this.importLogs.save({
            id: newId(),
            user_id: user.id,
            image_urls: JSON.stringify([url]),
            image_sha256: sha,
            parse_signature: signature,
            provider: "deepseek",
            model: envOr("DEEPSEEK_MODEL", "deepseek-flash"),
            tokens_in: outcome.tokens_in,
            tokens_out: outcome.tokens_out,
            latency_ms: outcome.latency_ms,
            status: outcome.status,
            raw_response: outcome.raw_response,
            parsed_json: parsed === null ? null : JSON.stringify(parsed),
            error_message: outcome.error_message,
            transaction_id: null,
            idempotency_key: null,
            created_at: now,
            updated_at: now,
        });

        return {data: this.cachedPayload(log, categoryInfos)};
    }

    private async fetchImage(url: string): Promise<{bytes: Buffer; contentType: string}> {
        let response: Response;
        try {
            response = await fetch(url, {signal: AbortSignal.timeout(10_000)});
        } catch (error) {
            throw ApiError.upstreamError(String(error));
        }
        if (!response.ok) {
            throw ApiError.upstreamError(`image fetch failed (${response.status})`);
        }
        const header = response.headers.get("content-type");
        const contentType = (header?.split(";")[0]?.trim() || "application/octet-stream") as string;
        const arrayBuffer = await response.arrayBuffer();
        return {bytes: Buffer.from(arrayBuffer), contentType};
    }

    @Post("confirm")
    async confirm(@CurrentUser() user: User, @Req() request: RawBodyRequest<Request>, @Res() response: ExpressResponse): Promise<void> {
        const raw = request.rawBody ?? Buffer.from("");
        const header = request.headers["idempotency-key"];
        const idempotencyKey = Array.isArray(header) ? (header[0] ?? null) : (header ?? null);

        const result = await this.idempotency.wrap({
            userId: user.id,
            method: "POST",
            path: "/api/v1/ai/confirm",
            rawBody: raw,
            idempotencyKey,
            run: async () => {
                const body = jsonParse<JsonObject>(raw.toString("utf8"), {});
                const logId = typeof body.ai_import_log_id === "string" ? body.ai_import_log_id : typeof body.import_log_id === "string" ? body.import_log_id : null;
                if (!logId) {
                    throw ApiError.parameterMissing("import_log_id");
                }

                const log = await this.importLogs.findOne({
                    where: {id: logId, user_id: user.id},
                });
                if (!log) {
                    throw ApiError.notFound();
                }

                const transactionBody: JsonObject = {...body};
                delete transactionBody.ai_import_log_id;
                delete transactionBody.import_log_id;
                const hasUrls = Array.isArray(transactionBody.image_urls) && transactionBody.image_urls.length > 0;
                if (!hasUrls) {
                    transactionBody.image_urls = jsonParseArray(log.image_urls);
                }
                transactionBody.source = "ai";

                const transaction = await this.transactions.createValidated(user.id, transactionBody, 2);

                await this.importLogs.update({id: log.id}, {transaction_id: transaction.id, updated_at: time.toDbDatetime(time.nowLocal())});

                return {
                    status: 201,
                    body: {data: transactionPayloadWithNet(transaction, true)},
                };
            },
        });

        response.status(result.status).json(result.body);
    }
}
