import type {Account} from "../database/entities/account.entity";
import type {AiImportLog} from "../database/entities/ai-import-log.entity";
import type {Category} from "../database/entities/category.entity";
import type {Merchant} from "../database/entities/merchant.entity";
import type {RecurringRule} from "../database/entities/recurring-rule.entity";
import type {Transaction} from "../database/entities/transaction.entity";
import type {User} from "../database/entities/user.entity";

import {formatDate, formatDatetime, fromDbDate, fromDbDatetime} from "../common/time";
import {jsonParseArray} from "../common/util";
import {accountKindName, aiStatusName, categoryKindName, frequencyName, statusName, transactionKindName, transactionSourceName} from "./enums";

function dbDatetime(value: string): string {
    return formatDatetime(fromDbDatetime(value));
}

export function userPayload(user: User): Record<string, unknown> {
    return {
        id: user.id,
        username: user.username,
        timezone: user.timezone,
        currency: user.currency,
    };
}

export function accountPayload(account: Account): Record<string, unknown> {
    return {
        id: account.id,
        name: account.name,
        kind: accountKindName(account.kind),
        icon: account.icon,
        color: account.color,
        initial_balance_cents: account.initial_balance_cents,
        currency: account.currency,
        created_at: dbDatetime(account.created_at),
        updated_at: dbDatetime(account.updated_at),
    };
}

export function categoryPayload(category: Category): Record<string, unknown> {
    return {
        id: category.id,
        name: category.name,
        kind: categoryKindName(category.kind),
        icon: category.icon,
        color: category.color,
        created_at: dbDatetime(category.created_at),
        updated_at: dbDatetime(category.updated_at),
    };
}

export function merchantPayload(merchant: Merchant): Record<string, unknown> {
    return {
        id: merchant.id,
        name: merchant.name,
        default_category_id: merchant.default_category_id,
        usage_count: merchant.usage_count,
        created_at: dbDatetime(merchant.created_at),
        updated_at: dbDatetime(merchant.updated_at),
    };
}

export function transactionPayload(transaction: Transaction): Record<string, unknown> {
    return {
        id: transaction.id,
        user_id: transaction.user_id,
        account_id: transaction.account_id,
        category_id: transaction.category_id,
        merchant_id: transaction.merchant_id,
        kind: transactionKindName(transaction.kind),
        amount_cents: transaction.amount_cents,
        currency: transaction.currency,
        occurred_at: dbDatetime(transaction.occurred_at),
        note: transaction.note,
        payment_method: transaction.payment_method,
        image_urls: jsonParseArray(transaction.image_urls),
        source: transactionSourceName(transaction.source),
        transfer_account_id: transaction.transfer_account_id,
        created_at: dbDatetime(transaction.created_at),
        updated_at: dbDatetime(transaction.updated_at),
    };
}

/** Rows used by dashboard + summaries (no `user_id` / timestamps). */
export function transactionRow(transaction: Transaction): Record<string, unknown> {
    return {
        id: transaction.id,
        account_id: transaction.account_id,
        category_id: transaction.category_id,
        merchant_id: transaction.merchant_id,
        kind: transactionKindName(transaction.kind),
        amount_cents: transaction.amount_cents,
        currency: transaction.currency,
        occurred_at: dbDatetime(transaction.occurred_at),
        note: transaction.note,
        payment_method: transaction.payment_method,
        image_urls: jsonParseArray(transaction.image_urls),
        source: transactionSourceName(transaction.source),
        transfer_account_id: transaction.transfer_account_id,
    };
}

/**
 * Legacy payload used by `run_now` / `ai.confirm`: includes `net_amount_cents`
 * (equal to `amount_cents`).
 */
export function transactionPayloadWithNet(transaction: Transaction, includeImageUrls: boolean): Record<string, unknown> {
    const value: Record<string, unknown> = {
        id: transaction.id,
        account_id: transaction.account_id,
        category_id: transaction.category_id,
        merchant_id: transaction.merchant_id,
        kind: transactionKindName(transaction.kind),
        amount_cents: transaction.amount_cents,
        currency: transaction.currency,
        occurred_at: dbDatetime(transaction.occurred_at),
        note: transaction.note,
        source: transactionSourceName(transaction.source),
        net_amount_cents: transaction.amount_cents,
    };
    if (includeImageUrls) {
        value.image_urls = jsonParseArray(transaction.image_urls);
    }
    return value;
}

export function rulePayload(rule: RecurringRule): Record<string, unknown> {
    return {
        id: rule.id,
        account_id: rule.account_id,
        category_id: rule.category_id,
        merchant_id: rule.merchant_id,
        kind: transactionKindName(rule.kind),
        amount_cents: rule.amount_cents,
        currency: rule.currency,
        frequency: frequencyName(rule.frequency),
        interval: rule.interval,
        day_of_week: rule.day_of_week,
        day_of_month: rule.day_of_month,
        month_of_year: rule.month_of_year,
        start_on: formatDate(fromDbDate(rule.start_on)),
        end_on: rule.end_on ? formatDate(fromDbDate(rule.end_on)) : null,
        next_run_at: dbDatetime(rule.next_run_at),
        last_run_at: rule.last_run_at ? dbDatetime(rule.last_run_at) : null,
        status: statusName(rule.status),
        note: rule.note,
        created_at: dbDatetime(rule.created_at),
        updated_at: dbDatetime(rule.updated_at),
    };
}

export interface AiPayloadInput {
    log: AiImportLog;
    parsed: unknown;
    suggestedCategoryId: string | null;
}

export function aiPayload(input: AiPayloadInput): Record<string, unknown> {
    return {
        id: input.log.id,
        image_urls: jsonParseArray(input.log.image_urls),
        sha256: input.log.image_sha256,
        status: aiStatusName(input.log.status),
        parsed: input.parsed,
        suggested_category_id: input.suggestedCategoryId,
        raw_response: input.log.raw_response,
        error: input.log.error_message,
        tokens_in: input.log.tokens_in,
        tokens_out: input.log.tokens_out,
        latency_ms: input.log.latency_ms,
    };
}

export interface InsightPayloadInput {
    period: string;
    range: {from: string; to: string};
    status: "success" | "failed" | "empty";
    text: string | null;
    highlights: string[];
    cached: boolean;
    generated_at: string | null;
    error: string | null;
    tokens_in: number | null;
    tokens_out: number | null;
    latency_ms: number | null;
}

/** Payload for `GET /summaries/:period/insight`. */
export function insightPayload(input: InsightPayloadInput): Record<string, unknown> {
    return {
        period: input.period,
        range: input.range,
        status: input.status,
        text: input.text,
        highlights: input.highlights,
        cached: input.cached,
        generated_at: input.generated_at,
        error: input.error,
        tokens_in: input.tokens_in,
        tokens_out: input.tokens_out,
        latency_ms: input.latency_ms,
    };
}
