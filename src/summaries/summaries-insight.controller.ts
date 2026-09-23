import {Controller, Get, Param, Query} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {Repository} from "typeorm";

import {DeepseekService, DeepSeekError, INSIGHT_PROMPT_VERSION, STATUS_SUCCESS} from "../ai/deepseek.service";
import {CurrentUser} from "../auth/current-user.decorator";
import {ApiError} from "../common/errors";
import * as time from "../common/time";
import {jsonParseArray, newId} from "../common/util";
import {envOr} from "../config/env";
import {SummaryInsight} from "../database/entities/summary-insight.entity";
import type {User} from "../database/entities/user.entity";
import {insightPayload} from "../views/serializers";
import {buildInsightFacts, insightFactSheet, parseInsightPeriod, periodKey, previousPeriodDate, summaryFingerprint} from "./insight";
import type {InsightPeriod, SummaryData} from "./insight";
import {SummariesService} from "./summaries.service";

function truthy(value: string | undefined): boolean {
    return value === "1" || value === "true";
}

function formatGeneratedAt(value: string | null): string | null {
    return value === null ? null : time.formatDatetime(time.fromDbDatetime(value));
}

@Controller("api/v1/summaries")
export class SummariesInsightController {
    constructor(
        private readonly summaries: SummariesService,
        private readonly deepseek: DeepseekService,
        @InjectRepository(SummaryInsight) private readonly insights: Repository<SummaryInsight>
    ) {}

    /**
     * AI 收支概況。以 `(user, period, period_key, fingerprint)` 為 cache key：
     * 數據一變 fingerprint 就變，自然失效重算，唔需要喺寫入交易時 eager 更新。
     */
    @Get(":period/insight")
    async insight(@CurrentUser() user: User, @Param("period") periodParam: string, @Query("date") dateParam?: string, @Query("refresh") refresh?: string): Promise<unknown> {
        const period = parseInsightPeriod(periodParam);
        if (period === null) {
            throw ApiError.invalidValue();
        }

        const {data, regular} = await this.summaries.build(user.id, period, dateParam, "1", "1");
        const key = periodKey(period, data.range);
        const fingerprint = summaryFingerprint(data);

        if (data.transactions.meta.total === 0 && data.transfers.count === 0) {
            return {
                data: insightPayload({
                    period,
                    range: data.range,
                    status: "empty",
                    text: null,
                    highlights: [],
                    cached: false,
                    generated_at: null,
                    error: null,
                    tokens_in: null,
                    tokens_out: null,
                    latency_ms: null,
                }),
            };
        }

        if (!truthy(refresh)) {
            const cached = await this.findCached(user.id, period, key, fingerprint);
            if (cached !== null) {
                return {data: this.payload(cached, data.range, true)};
            }
        }

        const facts = buildInsightFacts(period, data, await this.previousData(user.id, period, data.range), regular);

        let outcome;
        try {
            outcome = await this.deepseek.callInsight(insightFactSheet(facts));
        } catch (error) {
            if (error instanceof DeepSeekError) {
                throw ApiError.upstreamError(error.message);
            }
            throw error;
        }

        const now = time.toDbDatetime(time.nowLocal());
        const saved = await this.insights.save({
            id: newId(),
            user_id: user.id,
            period,
            period_key: key,
            fingerprint,
            prompt_version: INSIGHT_PROMPT_VERSION,
            provider: "deepseek",
            model: envOr("DEEPSEEK_MODEL", "deepseek-flash"),
            status: outcome.status,
            text: outcome.text,
            highlights_json: JSON.stringify(outcome.highlights),
            raw_response: outcome.raw_response,
            error_message: outcome.error_message,
            tokens_in: outcome.tokens_in,
            tokens_out: outcome.tokens_out,
            latency_ms: outcome.latency_ms,
            created_at: now,
            updated_at: now,
        });

        return {data: this.payload(saved, data.range, false)};
    }

    private async previousData(userId: string, period: InsightPeriod, range: {from: string}): Promise<SummaryData | null> {
        const previous = await this.summaries.build(userId, period, previousPeriodDate(period, range), "1", "1");
        return previous.data.transactions.meta.total > 0 || previous.data.transfers.count > 0 ? previous.data : null;
    }

    private findCached(userId: string, period: string, key: string, fingerprint: string): Promise<SummaryInsight | null> {
        return this.insights.findOne({
            where: {user_id: userId, period, period_key: key, fingerprint, prompt_version: INSIGHT_PROMPT_VERSION},
            order: {created_at: "DESC"},
        });
    }

    private payload(row: SummaryInsight, range: {from: string; to: string}, cached: boolean): Record<string, unknown> {
        const success = row.status === STATUS_SUCCESS && row.text !== null;
        return insightPayload({
            period: row.period,
            range,
            status: success ? "success" : "failed",
            text: success ? row.text : null,
            highlights: success ? jsonParseArray(row.highlights_json) : [],
            cached,
            generated_at: formatGeneratedAt(row.created_at),
            error: success ? null : row.error_message,
            tokens_in: row.tokens_in,
            tokens_out: row.tokens_out,
            latency_ms: row.latency_ms,
        });
    }
}
