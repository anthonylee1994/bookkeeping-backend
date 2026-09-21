use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const UP: &[&str] = &[
    r"CREATE TABLE IF NOT EXISTS users (
        id varchar(36) NOT NULL PRIMARY KEY,
        username varchar NOT NULL,
        password_digest varchar NOT NULL,
        timezone varchar NOT NULL DEFAULT 'Asia/Hong_Kong',
        currency varchar NOT NULL DEFAULT 'HKD',
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL
    )",
    r"CREATE UNIQUE INDEX IF NOT EXISTS index_users_on_username ON users (username)",
    r"CREATE TABLE IF NOT EXISTS accounts (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        name varchar NOT NULL,
        kind integer NOT NULL,
        icon varchar,
        color varchar,
        initial_balance_cents integer NOT NULL DEFAULT 0,
        currency varchar NOT NULL DEFAULT 'HKD',
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        CONSTRAINT fk_accounts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )",
    r"CREATE INDEX IF NOT EXISTS index_accounts_on_user_id ON accounts (user_id)",
    r"CREATE UNIQUE INDEX IF NOT EXISTS index_accounts_on_user_id_and_name ON accounts (user_id, name)",
    r"CREATE TABLE IF NOT EXISTS categories (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        name varchar NOT NULL,
        kind integer NOT NULL,
        icon varchar,
        color varchar,
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        CONSTRAINT fk_categories_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )",
    r"CREATE INDEX IF NOT EXISTS index_categories_on_user_id ON categories (user_id)",
    r"CREATE UNIQUE INDEX IF NOT EXISTS index_categories_on_user_id_and_kind_and_name ON categories (user_id, kind, name)",
    r"CREATE TABLE IF NOT EXISTS merchants (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        name varchar NOT NULL,
        default_category_id varchar(36),
        usage_count integer NOT NULL DEFAULT 0,
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        CONSTRAINT fk_merchants_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_merchants_default_category FOREIGN KEY (default_category_id) REFERENCES categories (id) ON DELETE SET NULL
    )",
    r"CREATE INDEX IF NOT EXISTS index_merchants_on_user_id ON merchants (user_id)",
    r"CREATE UNIQUE INDEX IF NOT EXISTS index_merchants_on_user_id_and_name ON merchants (user_id, name)",
    r"CREATE INDEX IF NOT EXISTS index_merchants_on_default_category_id ON merchants (default_category_id)",
    r"CREATE TABLE IF NOT EXISTS transactions (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        account_id varchar(36) NOT NULL,
        category_id varchar(36),
        merchant_id varchar(36),
        kind integer NOT NULL,
        amount_cents integer NOT NULL,
        currency varchar NOT NULL DEFAULT 'HKD',
        occurred_at datetime NOT NULL,
        note text,
        payment_method varchar,
        image_urls text NOT NULL DEFAULT '[]',
        source integer NOT NULL DEFAULT 0,
        transfer_account_id varchar(36),
        idempotency_key varchar,
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        CONSTRAINT fk_transactions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_transactions_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
        CONSTRAINT fk_transactions_transfer_account FOREIGN KEY (transfer_account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
        CONSTRAINT fk_transactions_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
        CONSTRAINT fk_transactions_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE SET NULL
    )",
    r"CREATE INDEX IF NOT EXISTS index_transactions_on_user_id ON transactions (user_id)",
    r"CREATE INDEX IF NOT EXISTS index_transactions_on_account_id ON transactions (account_id)",
    r"CREATE INDEX IF NOT EXISTS index_transactions_on_category_id ON transactions (category_id)",
    r"CREATE INDEX IF NOT EXISTS index_transactions_on_merchant_id ON transactions (merchant_id)",
    r"CREATE INDEX IF NOT EXISTS index_transactions_on_transfer_account_id ON transactions (transfer_account_id)",
    r"CREATE INDEX IF NOT EXISTS index_transactions_on_user_id_and_occurred_at ON transactions (user_id, occurred_at)",
    r"CREATE INDEX IF NOT EXISTS index_transactions_on_user_id_and_kind_and_occurred_at ON transactions (user_id, kind, occurred_at)",
    r"CREATE INDEX IF NOT EXISTS index_transactions_on_user_id_and_occurred_at_and_kind ON transactions (user_id, occurred_at, kind)",
    r"CREATE TABLE IF NOT EXISTS recurring_rules (
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
        start_on date NOT NULL,
        end_on date,
        next_run_at datetime NOT NULL,
        last_run_at datetime,
        status integer NOT NULL DEFAULT 0,
        note text,
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        CONSTRAINT fk_recurring_rules_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_recurring_rules_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
        CONSTRAINT fk_recurring_rules_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
        CONSTRAINT fk_recurring_rules_merchant FOREIGN KEY (merchant_id) REFERENCES merchants (id) ON DELETE SET NULL
    )",
    r"CREATE INDEX IF NOT EXISTS index_recurring_rules_on_user_id ON recurring_rules (user_id)",
    r"CREATE INDEX IF NOT EXISTS index_recurring_rules_on_account_id ON recurring_rules (account_id)",
    r"CREATE INDEX IF NOT EXISTS index_recurring_rules_on_category_id ON recurring_rules (category_id)",
    r"CREATE INDEX IF NOT EXISTS index_recurring_rules_on_merchant_id ON recurring_rules (merchant_id)",
    r"CREATE INDEX IF NOT EXISTS index_recurring_rules_on_user_id_and_status_and_next_run_at ON recurring_rules (user_id, status, next_run_at)",
    r"CREATE TABLE IF NOT EXISTS recurring_occurrences (
        id varchar(36) NOT NULL PRIMARY KEY,
        recurring_rule_id varchar(36) NOT NULL,
        occurred_on date NOT NULL,
        transaction_id varchar(36),
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        CONSTRAINT fk_recurring_occurrences_rule FOREIGN KEY (recurring_rule_id) REFERENCES recurring_rules (id) ON DELETE CASCADE,
        CONSTRAINT fk_recurring_occurrences_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE SET NULL
    )",
    r"CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_occurrences_unique ON recurring_occurrences (recurring_rule_id, occurred_on)",
    r"CREATE INDEX IF NOT EXISTS index_recurring_occurrences_on_recurring_rule_id ON recurring_occurrences (recurring_rule_id)",
    r"CREATE INDEX IF NOT EXISTS index_recurring_occurrences_on_transaction_id ON recurring_occurrences (transaction_id)",
    r"CREATE TABLE IF NOT EXISTS ai_import_logs (
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
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        CONSTRAINT fk_ai_import_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_ai_import_logs_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE SET NULL
    )",
    r"CREATE INDEX IF NOT EXISTS index_ai_import_logs_on_user_id ON ai_import_logs (user_id)",
    r"CREATE INDEX IF NOT EXISTS index_ai_import_logs_on_image_sha256 ON ai_import_logs (image_sha256)",
    r"CREATE INDEX IF NOT EXISTS index_ai_import_logs_on_transaction_id ON ai_import_logs (transaction_id)",
    r"CREATE INDEX IF NOT EXISTS idx_on_user_id_image_sha256_created_at_a5f17f3d34 ON ai_import_logs (user_id, image_sha256, created_at)",
    r"CREATE INDEX IF NOT EXISTS idx_ai_import_logs_cache_lookup ON ai_import_logs (user_id, image_sha256, parse_signature)",
    r"CREATE TABLE IF NOT EXISTS idempotency_keys (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        key varchar NOT NULL,
        request_hash varchar NOT NULL,
        response_status integer,
        response_body text,
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        CONSTRAINT fk_idempotency_keys_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )",
    r"CREATE INDEX IF NOT EXISTS index_idempotency_keys_on_user_id ON idempotency_keys (user_id)",
    r"CREATE UNIQUE INDEX IF NOT EXISTS index_idempotency_keys_on_user_id_and_key ON idempotency_keys (user_id, key)",
    r"CREATE INDEX IF NOT EXISTS index_idempotency_keys_on_created_at ON idempotency_keys (created_at)",
];

const DOWN: &[&str] = &[
    "DROP TABLE IF EXISTS idempotency_keys",
    "DROP TABLE IF EXISTS ai_import_logs",
    "DROP TABLE IF EXISTS recurring_occurrences",
    "DROP TABLE IF EXISTS recurring_rules",
    "DROP TABLE IF EXISTS transactions",
    "DROP TABLE IF EXISTS merchants",
    "DROP TABLE IF EXISTS categories",
    "DROP TABLE IF EXISTS accounts",
    "DROP TABLE IF EXISTS users",
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        for stmt in UP {
            db.execute_unprepared(stmt).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        for stmt in DOWN {
            db.execute_unprepared(stmt).await?;
        }
        Ok(())
    }
}
