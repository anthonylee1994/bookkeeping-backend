import type {MigrationInterface, QueryRunner} from "typeorm";

/**
 * Initial schema.
 *
 * Mirrors the original Rails / loco.rs / Prisma schema exactly (tables,
 * columns, indexes, foreign keys). Every statement uses `IF NOT EXISTS` so the
 * migration is safe to run against a pre-existing legacy database: the schema
 * is already there, nothing is recreated, and TypeORM records the migration as
 * applied afterwards (replacing the old Prisma `P3005` baseline dance).
 *
 * Date/time columns are declared `varchar` (TEXT affinity) because the whole
 * application stores the canonical HK-local strings and never converts to UTC.
 */
export class InitSchema20260921000000 implements MigrationInterface {
    name = "InitSchema20260921000000";

    private readonly statements: string[] = [
        `CREATE TABLE IF NOT EXISTS users (
        id varchar(36) NOT NULL PRIMARY KEY,
        username varchar NOT NULL,
        password_digest varchar NOT NULL,
        timezone varchar NOT NULL DEFAULT 'Asia/Hong_Kong',
        currency varchar NOT NULL DEFAULT 'HKD',
        created_at varchar NOT NULL,
        updated_at varchar NOT NULL
    )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS index_users_on_username ON users (username)`,

        `CREATE TABLE IF NOT EXISTS accounts (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        name varchar NOT NULL,
        kind integer NOT NULL,
        icon varchar,
        color varchar,
        initial_balance_cents integer NOT NULL DEFAULT 0,
        currency varchar NOT NULL DEFAULT 'HKD',
        created_at varchar NOT NULL,
        updated_at varchar NOT NULL,
        CONSTRAINT fk_accounts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )`,
        `CREATE INDEX IF NOT EXISTS index_accounts_on_user_id ON accounts (user_id)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS index_accounts_on_user_id_and_name ON accounts (user_id, name)`,

        `CREATE TABLE IF NOT EXISTS categories (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        name varchar NOT NULL,
        kind integer NOT NULL,
        icon varchar,
        color varchar,
        created_at varchar NOT NULL,
        updated_at varchar NOT NULL,
        CONSTRAINT fk_categories_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )`,
        `CREATE INDEX IF NOT EXISTS index_categories_on_user_id ON categories (user_id)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS index_categories_on_user_id_and_kind_and_name ON categories (user_id, kind, name)`,

        `CREATE TABLE IF NOT EXISTS merchants (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        name varchar NOT NULL,
        default_category_id varchar(36),
        usage_count integer NOT NULL DEFAULT 0,
        created_at varchar NOT NULL,
        updated_at varchar NOT NULL,
        CONSTRAINT fk_merchants_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_merchants_default_category FOREIGN KEY (default_category_id) REFERENCES categories (id) ON DELETE SET NULL
    )`,
        `CREATE INDEX IF NOT EXISTS index_merchants_on_user_id ON merchants (user_id)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS index_merchants_on_user_id_and_name ON merchants (user_id, name)`,
        `CREATE INDEX IF NOT EXISTS index_merchants_on_default_category_id ON merchants (default_category_id)`,

        `CREATE TABLE IF NOT EXISTS transactions (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        account_id varchar(36) NOT NULL,
        category_id varchar(36),
        merchant_id varchar(36),
        kind integer NOT NULL,
        amount_cents integer NOT NULL,
        currency varchar NOT NULL DEFAULT 'HKD',
        occurred_at varchar NOT NULL,
        note text,
        payment_method varchar,
        image_urls text NOT NULL DEFAULT '[]',
        source integer NOT NULL DEFAULT 0,
        transfer_account_id varchar(36),
        idempotency_key varchar,
        created_at varchar NOT NULL,
        updated_at varchar NOT NULL,
        CONSTRAINT fk_transactions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_transactions_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
        CONSTRAINT fk_transactions_transfer_account FOREIGN KEY (transfer_account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
        CONSTRAINT fk_transactions_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
        CONSTRAINT fk_transactions_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE SET NULL
    )`,
        `CREATE INDEX IF NOT EXISTS index_transactions_on_user_id ON transactions (user_id)`,
        `CREATE INDEX IF NOT EXISTS index_transactions_on_account_id ON transactions (account_id)`,
        `CREATE INDEX IF NOT EXISTS index_transactions_on_category_id ON transactions (category_id)`,
        `CREATE INDEX IF NOT EXISTS index_transactions_on_merchant_id ON transactions (merchant_id)`,
        `CREATE INDEX IF NOT EXISTS index_transactions_on_transfer_account_id ON transactions (transfer_account_id)`,
        `CREATE INDEX IF NOT EXISTS index_transactions_on_user_id_and_occurred_at ON transactions (user_id, occurred_at)`,
        `CREATE INDEX IF NOT EXISTS index_transactions_on_user_id_and_kind_and_occurred_at ON transactions (user_id, kind, occurred_at)`,
        `CREATE INDEX IF NOT EXISTS index_transactions_on_user_id_and_occurred_at_and_kind ON transactions (user_id, occurred_at, kind)`,

        `CREATE TABLE IF NOT EXISTS recurring_rules (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        account_id varchar(36) NOT NULL,
        category_id varchar(36),
        merchant_id varchar(36),
        kind integer NOT NULL,
        amount_cents integer NOT NULL,
        currency varchar NOT NULL DEFAULT 'HKD',
        frequency integer NOT NULL,
        interval integer NOT NULL DEFAULT 1,
        day_of_week integer,
        day_of_month integer,
        month_of_year integer,
        start_on varchar NOT NULL,
        end_on varchar,
        next_run_at varchar NOT NULL,
        last_run_at varchar,
        status integer NOT NULL DEFAULT 0,
        note text,
        created_at varchar NOT NULL,
        updated_at varchar NOT NULL,
        CONSTRAINT fk_recurring_rules_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_recurring_rules_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
        CONSTRAINT fk_recurring_rules_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
        CONSTRAINT fk_recurring_rules_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE SET NULL
    )`,
        `CREATE INDEX IF NOT EXISTS index_recurring_rules_on_user_id ON recurring_rules (user_id)`,
        `CREATE INDEX IF NOT EXISTS index_recurring_rules_on_account_id ON recurring_rules (account_id)`,
        `CREATE INDEX IF NOT EXISTS index_recurring_rules_on_category_id ON recurring_rules (category_id)`,
        `CREATE INDEX IF NOT EXISTS index_recurring_rules_on_merchant_id ON recurring_rules (merchant_id)`,
        `CREATE INDEX IF NOT EXISTS index_recurring_rules_on_user_id_and_status_and_next_run_at ON recurring_rules (user_id, status, next_run_at)`,

        `CREATE TABLE IF NOT EXISTS recurring_occurrences (
        id varchar(36) NOT NULL PRIMARY KEY,
        recurring_rule_id varchar(36) NOT NULL,
        occurred_on varchar NOT NULL,
        transaction_id varchar(36),
        created_at varchar NOT NULL,
        updated_at varchar NOT NULL,
        CONSTRAINT fk_recurring_occurrences_rule FOREIGN KEY (recurring_rule_id) REFERENCES recurring_rules (id) ON DELETE CASCADE,
        CONSTRAINT fk_recurring_occurrences_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE SET NULL
    )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_occurrences_unique ON recurring_occurrences (recurring_rule_id, occurred_on)`,
        `CREATE INDEX IF NOT EXISTS index_recurring_occurrences_on_recurring_rule_id ON recurring_occurrences (recurring_rule_id)`,
        `CREATE INDEX IF NOT EXISTS index_recurring_occurrences_on_transaction_id ON recurring_occurrences (transaction_id)`,

        `CREATE TABLE IF NOT EXISTS ai_import_logs (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        image_urls text NOT NULL DEFAULT '[]',
        image_sha256 varchar NOT NULL,
        parse_signature varchar,
        provider varchar NOT NULL DEFAULT 'deepseek',
        model varchar NOT NULL DEFAULT 'deepseek-flash',
        tokens_in integer,
        tokens_out integer,
        latency_ms integer,
        status integer NOT NULL DEFAULT 0,
        raw_response text,
        parsed_json text,
        error_message text,
        transaction_id varchar(36),
        idempotency_key varchar,
        created_at varchar NOT NULL,
        updated_at varchar NOT NULL,
        CONSTRAINT fk_ai_import_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_ai_import_logs_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE SET NULL
    )`,
        `CREATE INDEX IF NOT EXISTS index_ai_import_logs_on_user_id ON ai_import_logs (user_id)`,
        `CREATE INDEX IF NOT EXISTS index_ai_import_logs_on_image_sha256 ON ai_import_logs (image_sha256)`,
        `CREATE INDEX IF NOT EXISTS index_ai_import_logs_on_transaction_id ON ai_import_logs (transaction_id)`,
        `CREATE INDEX IF NOT EXISTS idx_on_user_id_image_sha256_created_at_a5f17f3d34 ON ai_import_logs (user_id, image_sha256, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_ai_import_logs_cache_lookup ON ai_import_logs (user_id, image_sha256, parse_signature)`,

        `CREATE TABLE IF NOT EXISTS idempotency_keys (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        key varchar NOT NULL,
        request_hash varchar NOT NULL,
        response_status integer,
        response_body text,
        created_at varchar NOT NULL,
        updated_at varchar NOT NULL,
        CONSTRAINT fk_idempotency_keys_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )`,
        `CREATE INDEX IF NOT EXISTS index_idempotency_keys_on_user_id ON idempotency_keys (user_id)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS index_idempotency_keys_on_user_id_and_key ON idempotency_keys (user_id, key)`,
        `CREATE INDEX IF NOT EXISTS index_idempotency_keys_on_created_at ON idempotency_keys (created_at)`,
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const statement of this.statements) {
            await queryRunner.query(statement);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ["idempotency_keys", "ai_import_logs", "recurring_occurrences", "recurring_rules", "transactions", "merchants", "categories", "accounts", "users"]) {
            await queryRunner.query(`DROP TABLE IF EXISTS ${table}`);
        }
    }
}
