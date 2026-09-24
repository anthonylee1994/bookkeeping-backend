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
import {Account} from "../database/entities/account.entity";
import {Category} from "../database/entities/category.entity";
import {Merchant} from "../database/entities/merchant.entity";
import type {User} from "../database/entities/user.entity";
import {IdempotencyService} from "../idempotency/idempotency.service";
import {TransactionsService} from "../transactions/transactions.service";
import {aiPayload, aiQueryPayload, categorySuggestionPayload, transactionPayloadWithNet} from "../views/serializers";
import {DeepseekService, DeepSeekError, PROMPT_VERSION, STATUS_SUCCESS} from "./deepseek.service";

/** 自然語言打字記帳嘅輸入上限（字元）。 */
export const MAX_INTERPRET_TEXT = 500;
/** 自然語言查詢嘅輸入上限（字元）。 */
export const MAX_QUERY_TEXT = 500;
/** 自動分類建議嘅商戶名／備註輸入上限（字元）。 */
export const MAX_SUGGEST_MERCHANT = 200;
export const MAX_SUGGEST_NOTE = 500;

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

interface ParsedItem {
    parsed: Record<string, unknown>;
    suggestedCategoryId: string | null;
}

/** `parsed_json` 新格式係 array（多筆），舊格式／receipt 係單一 object。 */
function storedParsedList(raw: unknown): Record<string, unknown>[] {
    if (Array.isArray(raw)) return raw.filter(isPlainObject);
    if (isPlainObject(raw)) return [raw];
    return [];
}

interface NamedRef {
    id: string;
    name: string;
}

interface QueryRefs {
    accounts: NamedRef[];
    categories: CategoryInfo[];
    merchants: NamedRef[];
}

/** 以不分大小寫嘅完整名稱比對，回對應 id；搵唔到回 null。 */
function resolveNamed(items: NamedRef[], name: unknown): string | null {
    if (typeof name !== "string") return null;
    const target = name.trim().toLowerCase();
    if (target === "") return null;
    return items.find(item => item.name.trim().toLowerCase() === target)?.id ?? null;
}

/** 同名分類可能橫跨收入／支出；有指定 kind 就優先夾返同一 kind。 */
function resolveCategory(categories: CategoryInfo[], name: unknown, kind: unknown): string | null {
    if (typeof name !== "string") return null;
    const target = name.trim().toLowerCase();
    if (target === "") return null;
    const matches = categories.filter(category => category.name.trim().toLowerCase() === target);
    if (matches.length === 0) return null;
    if (kind === "income" || kind === "expense") {
        const kindValue = kind === "income" ? 0 : 1;
        const byKind = matches.find(category => category.kind === kindValue);
        if (byKind) return byKind.id;
    }
    return matches[0].id;
}

@Controller("api/v1/ai")
export class AiController {
    constructor(
        @InjectRepository(AiImportLog) private readonly importLogs: Repository<AiImportLog>,
        @InjectRepository(Account) private readonly accounts: Repository<Account>,
        @InjectRepository(Category) private readonly categories: Repository<Category>,
        @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
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
        return aiPayload({log, parsedItems: this.normalizedItems(raw, categoryInfos)});
    }

    /**
     * 由 `parsed_json` 還原多筆 items。新格式係 array，舊 cache／receipt 係單一
     * object；每筆都重新對當前用戶分類做 `normalizeCategoryHint`，唔會漏出 AI
     * 自創嘅分類名。
     */
    private normalizedItems(raw: unknown, categoryInfos: CategoryInfo[]): ParsedItem[] {
        return storedParsedList(raw).map(item => {
            const normalized = normalizeCategoryHint(item, categoryInfos);
            const parsed = isPlainObject(normalized) ? normalized : item;
            return {parsed, suggestedCategoryId: matchCategory(parsed, categoryInfos)?.id ?? null};
        });
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

    private interpretSignature(categoryInfos: CategoryInfo[]): string {
        const keys = categoryInfos.map(category => `${kindKey(category.kind)}:${category.name}`).sort();
        return sha256Hex(`text\u0000${PROMPT_VERSION}\u0000${keys.join("\u0000")}`);
    }

    /**
     * 自然語言打字記帳：將一句文字交俾 DeepSeek，開一條 `source = text` 嘅
     * `AiImportLog`，回同 `/ai/parse` 一樣嘅 preview envelope，令前端可以重用
     * 覆核流程、`/ai/confirm` 亦原封不動用得返。
     */
    @Post("interpret")
    @HttpCode(200)
    async interpret(@CurrentUser() user: User, @Body() body: JsonObject): Promise<unknown> {
        if (typeof body.text !== "string" || body.text.trim() === "") {
            throw ApiError.parameterMissing("text");
        }
        const text = body.text.trim();
        if (text.length > MAX_INTERPRET_TEXT) {
            throw new ApiError(422, "validation_error", `text 不可超過 ${MAX_INTERPRET_TEXT} 字`);
        }

        const sha = sha256Hex(text);
        const categoryInfos = await this.loadCategoryInfos(user.id);
        const signature = this.interpretSignature(categoryInfos);

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

        const refs = categoryInfos.map(category => ({kind: category.kind, name: category.name}));

        let outcome;
        try {
            outcome = await this.deepseek.callInterpret(text, refs);
        } catch (error) {
            if (error instanceof DeepSeekError) {
                throw ApiError.upstreamError(error.message);
            }
            throw error;
        }

        const items = (Array.isArray(outcome.parsed) ? outcome.parsed : [])
            .filter(isPlainObject)
            .map(item => normalizeCategoryHint(item, categoryInfos))
            .filter(isPlainObject);

        const now = time.toDbDatetime(time.nowLocal());
        const log = await this.importLogs.save({
            id: newId(),
            user_id: user.id,
            image_urls: JSON.stringify([]),
            image_sha256: sha,
            parse_signature: signature,
            source: "text",
            provider: "deepseek",
            model: envOr("DEEPSEEK_MODEL", "deepseek-flash"),
            tokens_in: outcome.tokens_in,
            tokens_out: outcome.tokens_out,
            latency_ms: outcome.latency_ms,
            status: outcome.status,
            raw_response: outcome.raw_response,
            parsed_json: items.length === 0 ? null : JSON.stringify(items),
            error_message: outcome.error_message,
            transaction_id: null,
            idempotency_key: null,
            created_at: now,
            updated_at: now,
        });

        return {data: this.cachedPayload(log, categoryInfos)};
    }

    /**
     * 自然語言查詢：將一句問題交俾 DeepSeek 譯成現有 transaction-list filter
     * params（URL 同名），再由 controller 將 account／category／merchant 名稱解
     * 析成當前用戶嘅 id。唔會寫入任何資料，亦唔開 `AiImportLog`。
     */
    @Post("query")
    @HttpCode(200)
    async query(@CurrentUser() user: User, @Body() body: JsonObject): Promise<unknown> {
        if (typeof body.text !== "string" || body.text.trim() === "") {
            throw ApiError.parameterMissing("text");
        }
        const text = body.text.trim();
        if (text.length > MAX_QUERY_TEXT) {
            throw new ApiError(422, "validation_error", `text 不可超過 ${MAX_QUERY_TEXT} 字`);
        }

        const accountRows = await this.accounts.find({where: {user_id: user.id}, order: {created_at: "ASC"}});
        const categoryInfos = await this.loadCategoryInfos(user.id);
        const merchantRows = await this.merchants.find({where: {user_id: user.id}, order: {usage_count: "DESC"}, take: 100});
        const refs: QueryRefs = {
            accounts: accountRows.map(row => ({id: row.id, name: row.name})),
            categories: categoryInfos,
            merchants: merchantRows.map(row => ({id: row.id, name: row.name})),
        };

        let outcome;
        try {
            outcome = await this.deepseek.callQuery(text, {
                accounts: refs.accounts.map(item => item.name),
                categories: refs.categories.map(category => ({kind: category.kind, name: category.name})),
                merchants: refs.merchants.map(item => item.name),
            });
        } catch (error) {
            if (error instanceof DeepSeekError) {
                throw ApiError.upstreamError(error.message);
            }
            throw error;
        }

        const raw = outcome.query ?? {};
        const filters: Record<string, unknown> = {};
        if (typeof raw.from === "string" && typeof raw.to === "string") {
            filters.from = raw.from;
            filters.to = raw.to;
        }
        if (typeof raw.kind === "string") {
            filters.kind = raw.kind;
        }

        const accountId = resolveNamed(refs.accounts, raw.account_name);
        if (accountId !== null) {
            filters.account_id = accountId;
        }

        const categoryId = resolveCategory(refs.categories, raw.category_name, raw.kind);
        if (categoryId !== null) {
            filters.category_id = categoryId;
        }

        const merchantId = resolveNamed(refs.merchants, raw.merchant_name);
        if (merchantId !== null) {
            filters.merchant_id = merchantId;
        }

        // 商戶對唔上名單時退回關鍵字搜尋，唔會漏咗用戶指明嘅商戶。
        let keyword = typeof raw.keyword === "string" ? raw.keyword : null;
        if (merchantId === null && typeof raw.merchant_name === "string" && raw.merchant_name.trim() !== "") {
            keyword = raw.merchant_name.trim();
        }
        if (keyword !== null && keyword.trim() !== "") {
            filters.q = keyword.trim();
        }

        if (typeof raw.min_amount_cents === "number") {
            filters.min = raw.min_amount_cents;
        }
        if (typeof raw.max_amount_cents === "number") {
            filters.max = raw.max_amount_cents;
        }

        const usable = Object.keys(filters).length > 0;
        return {
            data: aiQueryPayload({
                status: usable ? "success" : "partial",
                filters: usable ? filters : null,
                explanation: outcome.explanation,
                error: outcome.error_message,
                tokens_in: outcome.tokens_in,
                tokens_out: outcome.tokens_out,
                latency_ms: outcome.latency_ms,
            }),
        };
    }

    /**
     * 自動分類建議：用戶喺交易表單打完商戶／備註後，若冇商戶預設分類就問
     * DeepSeek 揀一個分類。純建議，唔寫 DB、唔開 `AiImportLog`；controller 再
     * 將 model 回嘅名稱對當前用戶分類 resolve 做 id，對唔上就當冇建議。
     */
    @Post("suggest-category")
    @HttpCode(200)
    async suggestCategory(@CurrentUser() user: User, @Body() body: JsonObject): Promise<unknown> {
        const kind = body.kind;
        if (kind !== "income" && kind !== "expense") {
            throw ApiError.parameterMissing("kind");
        }

        const merchantName = typeof body.merchant_name === "string" ? body.merchant_name.trim() : "";
        const note = typeof body.note === "string" ? body.note.trim() : "";
        if (merchantName === "" && note === "") {
            throw new ApiError(422, "validation_error", "merchant_name or note is required");
        }
        if (merchantName.length > MAX_SUGGEST_MERCHANT) {
            throw new ApiError(422, "validation_error", `merchant_name 不可超過 ${MAX_SUGGEST_MERCHANT} 字`);
        }
        if (note.length > MAX_SUGGEST_NOTE) {
            throw new ApiError(422, "validation_error", `note 不可超過 ${MAX_SUGGEST_NOTE} 字`);
        }

        const categoryInfos = await this.loadCategoryInfos(user.id);

        let outcome;
        try {
            outcome = await this.deepseek.callSuggestCategory(
                {kind, merchantName: merchantName === "" ? null : merchantName, note: note === "" ? null : note},
                categoryInfos.map(category => ({kind: category.kind, name: category.name}))
            );
        } catch (error) {
            if (error instanceof DeepSeekError) {
                throw ApiError.upstreamError(error.message);
            }
            throw error;
        }

        const matched = outcome.category_name === null ? null : matchCategory({category_hint: outcome.category_name, kind}, categoryInfos);

        return {
            data: categorySuggestionPayload({
                status: matched === null ? "partial" : "success",
                category_id: matched?.id ?? null,
                category_name: matched?.name ?? null,
                confidence: outcome.confidence,
                error: outcome.error_message,
                tokens_in: outcome.tokens_in,
                tokens_out: outcome.tokens_out,
                latency_ms: outcome.latency_ms,
            }),
        };
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
