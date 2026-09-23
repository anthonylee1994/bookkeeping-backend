import {expect} from "vitest";
import {IsNull} from "typeorm";
import type {DataSource} from "typeorm";

import * as time from "../../src/common/time";
import {newId} from "../../src/common/util";
import {Account} from "../../src/database/entities/account.entity";
import {AiImportLog} from "../../src/database/entities/ai-import-log.entity";
import {Category} from "../../src/database/entities/category.entity";
import {IdempotencyKey} from "../../src/database/entities/idempotency-key.entity";
import {Merchant} from "../../src/database/entities/merchant.entity";
import {RecurringOccurrence} from "../../src/database/entities/recurring-occurrence.entity";
import {RecurringRule} from "../../src/database/entities/recurring-rule.entity";
import {Transaction} from "../../src/database/entities/transaction.entity";

import type {HttpClient} from "./app";

export interface Fixture {
    token: string;
    userId: string;
    accountId: string;
    expenseCategoryId: string;
}

export function authHeader(token: string): Record<string, string> {
    return {Authorization: `Bearer ${token}`};
}

export function idempotencyHeader(key: string): Record<string, string> {
    return {"Idempotency-Key": key};
}

export async function registerAndLogin(client: HttpClient): Promise<Fixture> {
    const register = await client.post("/api/v1/auth/register").send({username: "alice", password: "secret123"});
    expect(register.status).toBe(201);

    const login = await client.post("/api/v1/auth/login").send({username: "Alice", password: "secret123"});
    expect(login.status).toBe(200);
    const token = login.body.data.token as string;
    const userId = login.body.data.user.id as string;

    const accountsResponse = await client.get("/api/v1/accounts").set(authHeader(token));
    const accountId = accountsResponse.body.data[0].id as string;

    const categoriesResponse = await client.get("/api/v1/categories").set(authHeader(token));
    const expense = (categoriesResponse.body.data as Array<Record<string, unknown>>).find(row => row.kind === "expense");
    if (!expense) {
        throw new Error("expense category missing");
    }

    return {token, userId, accountId, expenseCategoryId: expense.id as string};
}

/** Registers a user directly (returns token + user id) without extra requests. */
export async function registerNamed(client: HttpClient, username: string): Promise<{token: string; userId: string}> {
    const response = await client.post("/api/v1/auth/register").send({username, password: "secret123"});
    expect(response.status).toBe(201);
    return {
        token: response.body.data.token as string,
        userId: response.body.data.user.id as string,
    };
}

export function at(year: number, month: number, day: number, hour: number, minute = 0): Date {
    const parsed = time.parseDatetime(`${time.toDbDate(new Date(Date.UTC(year, month - 1, day)))}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
    if (!parsed) {
        throw new Error("invalid test date");
    }
    return parsed;
}

/** A minimal but valid JPEG magic-number payload. */
export function jpegBytes(): Buffer {
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("x".repeat(20))]);
}

export async function createAccount(dataSource: DataSource, userId: string, name: string, kind: number): Promise<Account> {
    const now = time.toDbDatetime(time.nowLocal());
    return dataSource.getRepository(Account).save({
        id: newId(),
        user_id: userId,
        name,
        kind,
        icon: null,
        color: null,
        initial_balance_cents: 0,
        currency: "HKD",
        created_at: now,
        updated_at: now,
    });
}

export async function createCategory(dataSource: DataSource, userId: string, name: string, kind: number): Promise<Category> {
    const now = time.toDbDatetime(time.nowLocal());
    return dataSource.getRepository(Category).save({
        id: newId(),
        user_id: userId,
        name,
        kind,
        icon: null,
        color: null,
        created_at: now,
        updated_at: now,
    });
}

export async function createMerchant(dataSource: DataSource, userId: string, name: string, usageCount: number, defaultCategoryId: string | null): Promise<Merchant> {
    const now = time.toDbDatetime(time.nowLocal());
    return dataSource.getRepository(Merchant).save({
        id: newId(),
        user_id: userId,
        name,
        default_category_id: defaultCategoryId,
        usage_count: usageCount,
        created_at: now,
        updated_at: now,
    });
}

export async function createTransaction(
    dataSource: DataSource,
    userId: string,
    accountId: string,
    kind: number,
    amountCents: number,
    occurredAt: Date,
    categoryId: string | null,
    merchantId: string | null,
    transferAccountId: string | null,
    source: number,
    note: string | null = null
): Promise<Transaction> {
    const now = time.toDbDatetime(time.nowLocal());
    return dataSource.getRepository(Transaction).save({
        id: newId(),
        user_id: userId,
        account_id: accountId,
        category_id: categoryId,
        merchant_id: merchantId,
        kind,
        amount_cents: amountCents,
        currency: "HKD",
        occurred_at: time.toDbDatetime(occurredAt),
        note,
        payment_method: null,
        image_urls: "[]",
        source,
        transfer_account_id: transferAccountId,
        idempotency_key: null,
        created_at: now,
        updated_at: now,
    });
}

export async function createRule(dataSource: DataSource, userId: string, accountId: string, status: number, nextRunAt: Date, endOn: Date | null, note: string | null): Promise<RecurringRule> {
    const now = time.toDbDatetime(time.nowLocal());
    return dataSource.getRepository(RecurringRule).save({
        id: newId(),
        user_id: userId,
        account_id: accountId,
        category_id: null,
        merchant_id: null,
        kind: 1,
        amount_cents: 1000,
        currency: "HKD",
        frequency: 0,
        interval: 1,
        day_of_week: null,
        day_of_month: null,
        month_of_year: null,
        start_on: time.toDbDate(nextRunAt),
        end_on: endOn ? time.toDbDate(endOn) : null,
        next_run_at: time.toDbDatetime(nextRunAt),
        last_run_at: null,
        status,
        note,
        created_at: now,
        updated_at: now,
    });
}

export async function createImportLog(dataSource: DataSource, userId: string, imageSha256: string, parsedJson: unknown): Promise<AiImportLog> {
    const now = time.toDbDatetime(time.nowLocal());
    return dataSource.getRepository(AiImportLog).save({
        id: newId(),
        user_id: userId,
        image_urls: JSON.stringify(["https://img.eservice-hk.net/a.jpg"]),
        image_sha256: imageSha256,
        parse_signature: null,
        source: "receipt",
        provider: "deepseek",
        model: "deepseek-flash",
        tokens_in: null,
        tokens_out: null,
        latency_ms: null,
        status: 1,
        raw_response: null,
        parsed_json: JSON.stringify(parsedJson),
        error_message: null,
        transaction_id: null,
        idempotency_key: null,
        created_at: now,
        updated_at: now,
    });
}

export async function createIdempotencyKey(dataSource: DataSource, userId: string, key: string, createdAt: Date): Promise<void> {
    await dataSource.getRepository(IdempotencyKey).save({
        id: newId(),
        user_id: userId,
        key,
        request_hash: "hash",
        response_status: 200,
        response_body: "{}",
        created_at: time.toDbDatetime(createdAt),
        updated_at: time.toDbDatetime(createdAt),
    });
}

export function listTransactions(dataSource: DataSource, userId: string, source: number): Promise<Transaction[]> {
    return dataSource.getRepository(Transaction).find({where: {user_id: userId, source}});
}

export async function countTransactions(dataSource: DataSource, userId: string, source: number): Promise<number> {
    return (await listTransactions(dataSource, userId, source)).length;
}

export function countOccurrences(dataSource: DataSource, ruleId: string): Promise<number> {
    return dataSource.getRepository(RecurringOccurrence).count({
        where: {recurring_rule_id: ruleId},
    });
}

export function countOccurrencesWithoutTransaction(dataSource: DataSource, ruleId: string): Promise<number> {
    return dataSource.getRepository(RecurringOccurrence).count({
        where: {recurring_rule_id: ruleId, transaction_id: IsNull()},
    });
}

export async function findRule(dataSource: DataSource, ruleId: string): Promise<RecurringRule> {
    const rule = await dataSource.getRepository(RecurringRule).findOneBy({id: ruleId});
    if (!rule) {
        throw new Error("rule not found");
    }
    return rule;
}

export async function findLog(dataSource: DataSource, logId: string): Promise<AiImportLog> {
    const log = await dataSource.getRepository(AiImportLog).findOneBy({id: logId});
    if (!log) {
        throw new Error("log not found");
    }
    return log;
}
