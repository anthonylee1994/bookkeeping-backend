import {vi} from "vitest";
import type {DataSource, EntityManager, ObjectLiteral, Repository} from "typeorm";

import * as time from "../../src/common/time";
import {newId} from "../../src/common/util";
import {Account} from "../../src/database/entities/account.entity";
import {AiImportLog} from "../../src/database/entities/ai-import-log.entity";
import {Category} from "../../src/database/entities/category.entity";
import {IdempotencyKey} from "../../src/database/entities/idempotency-key.entity";
import {Merchant} from "../../src/database/entities/merchant.entity";
import {RecurringRule} from "../../src/database/entities/recurring-rule.entity";
import {Transaction} from "../../src/database/entities/transaction.entity";
import {User} from "../../src/database/entities/user.entity";

type Mock = ReturnType<typeof vi.fn>;

export interface MockRepo {
    find: Mock;
    findOne: Mock;
    findOneBy: Mock;
    findOneByOrFail: Mock;
    save: Mock;
    insert: Mock;
    update: Mock;
    delete: Mock;
    count: Mock;
}

/** A TypeORM `Repository` stand-in whose methods are all `vi.fn`s. */
export function mockRepo(overrides: Partial<MockRepo> = {}): MockRepo {
    return {
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        findOneBy: vi.fn().mockResolvedValue(null),
        findOneByOrFail: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockImplementation(async (entity: unknown) => entity),
        insert: vi.fn().mockResolvedValue({identifiers: []}),
        update: vi.fn().mockResolvedValue({affected: 0}),
        delete: vi.fn().mockResolvedValue({affected: 0}),
        count: vi.fn().mockResolvedValue(0),
        ...overrides,
    };
}

/** Cast a `MockRepo` to the repository type a controller/service asks for. */
export function repo<T extends ObjectLiteral>(mock: MockRepo): Repository<T> {
    return mock as unknown as Repository<T>;
}

export interface MockManager {
    save: Mock;
    insert: Mock;
    update: Mock;
    delete: Mock;
    findOne: Mock;
}

export function mockManager(overrides: Partial<MockManager> = {}): MockManager {
    return {
        save: vi.fn().mockImplementation(async (...args: unknown[]) => (args.length > 1 ? args[1] : args[0])),
        insert: vi.fn().mockResolvedValue({identifiers: []}),
        update: vi.fn().mockResolvedValue({affected: 0}),
        delete: vi.fn().mockResolvedValue({affected: 0}),
        findOne: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
}

export interface MockDataSource {
    transaction: Mock;
    manager: MockManager;
}

/** A `DataSource` whose `transaction(cb)` runs `cb` with a mock manager. */
export function mockDataSource(manager: MockManager = mockManager()): MockDataSource {
    return {
        transaction: vi.fn().mockImplementation(async (callback: (entityManager: EntityManager) => Promise<unknown>) => callback(manager as unknown as EntityManager)),
        manager,
    };
}

export function dataSource(mock: MockDataSource): DataSource {
    return mock as unknown as DataSource;
}

export interface MockResponse {
    status: Mock;
    json: Mock;
    type: Mock;
    send: Mock;
}

/** A chainable Express `Response` stand-in. */
export function mockResponse(): MockResponse {
    const response: MockResponse = {
        status: vi.fn(),
        json: vi.fn(),
        type: vi.fn(),
        send: vi.fn(),
    };
    response.status.mockReturnValue(response);
    response.json.mockReturnValue(response);
    response.type.mockReturnValue(response);
    response.send.mockReturnValue(response);
    return response;
}

function now(): string {
    return time.toDbDatetime(time.nowLocal());
}

export function userFixture(overrides: Partial<User> = {}): User {
    return {
        id: newId(),
        username: "alice",
        password_digest: "digest",
        timezone: "Asia/Hong_Kong",
        currency: "HKD",
        created_at: now(),
        updated_at: now(),
        ...overrides,
    };
}

export function accountFixture(overrides: Partial<Account> = {}): Account {
    return {
        id: newId(),
        user_id: "user-1",
        name: "現金",
        kind: 0,
        icon: null,
        color: null,
        initial_balance_cents: 0,
        currency: "HKD",
        created_at: now(),
        updated_at: now(),
        ...overrides,
    };
}

export function categoryFixture(overrides: Partial<Category> = {}): Category {
    return {
        id: newId(),
        user_id: "user-1",
        name: "飲食",
        kind: 1,
        icon: null,
        color: null,
        created_at: now(),
        updated_at: now(),
        ...overrides,
    };
}

export function merchantFixture(overrides: Partial<Merchant> = {}): Merchant {
    return {
        id: newId(),
        user_id: "user-1",
        name: "Starbucks",
        default_category_id: null,
        usage_count: 0,
        created_at: now(),
        updated_at: now(),
        ...overrides,
    };
}

export function transactionFixture(overrides: Partial<Transaction> = {}): Transaction {
    return {
        id: newId(),
        user_id: "user-1",
        account_id: "account-1",
        category_id: null,
        merchant_id: null,
        kind: 1,
        amount_cents: 1000,
        currency: "HKD",
        occurred_at: now(),
        note: null,
        payment_method: null,
        image_urls: "[]",
        source: 0,
        transfer_account_id: null,
        idempotency_key: null,
        created_at: now(),
        updated_at: now(),
        ...overrides,
    };
}

export function ruleFixture(overrides: Partial<RecurringRule> = {}): RecurringRule {
    const today = time.toDbDate(time.today());
    return {
        id: newId(),
        user_id: "user-1",
        account_id: "account-1",
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
        start_on: today,
        end_on: null,
        next_run_at: now(),
        last_run_at: null,
        status: 0,
        note: null,
        created_at: now(),
        updated_at: now(),
        ...overrides,
    };
}

export function importLogFixture(overrides: Partial<AiImportLog> = {}): AiImportLog {
    return {
        id: newId(),
        user_id: "user-1",
        image_urls: JSON.stringify(["https://img.eservice-hk.net/a.jpg"]),
        image_sha256: "a".repeat(64),
        parse_signature: null,
        source: "receipt",
        provider: "deepseek",
        model: "deepseek-flash",
        tokens_in: null,
        tokens_out: null,
        latency_ms: null,
        status: 1,
        raw_response: null,
        parsed_json: null,
        error_message: null,
        transaction_id: null,
        idempotency_key: null,
        created_at: now(),
        updated_at: now(),
        ...overrides,
    };
}

export function idempotencyFixture(overrides: Partial<IdempotencyKey> = {}): IdempotencyKey {
    return {
        id: newId(),
        user_id: "user-1",
        key: "key-1",
        request_hash: "hash",
        response_status: 200,
        response_body: "{}",
        created_at: now(),
        updated_at: now(),
        ...overrides,
    };
}
