use axum::http::{HeaderName, HeaderValue};
use loco_rs::{app::AppContext, TestServer};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde_json::Value;

use bookkeeping_backend::api::{time, util};
use bookkeeping_backend::models::_entities::{
    accounts, ai_import_logs, categories, idempotency_keys, merchants, recurring_occurrences,
    recurring_rules, transactions,
};

pub struct Fixture {
    pub token: String,
    pub user_id: String,
    pub account_id: String,
    pub expense_category_id: String,
}

pub fn auth_header(token: &str) -> (HeaderName, HeaderValue) {
    (
        HeaderName::from_static("authorization"),
        HeaderValue::from_str(&format!("Bearer {token}")).expect("valid header"),
    )
}

pub fn idempotency_header(key: &str) -> (HeaderName, HeaderValue) {
    (
        HeaderName::from_static("idempotency-key"),
        HeaderValue::from_str(key).expect("valid header"),
    )
}

pub fn json_body(response_text: &str) -> Value {
    serde_json::from_str(response_text).expect("valid json response")
}

pub async fn register_and_login(request: &TestServer, ctx: &AppContext) -> Fixture {
    let register = request
        .post("/api/v1/auth/register")
        .json(&serde_json::json!({ "username": "alice", "password": "secret123" }))
        .await;
    assert_eq!(register.status_code(), 201, "register should succeed");

    let login = request
        .post("/api/v1/auth/login")
        .json(&serde_json::json!({ "username": "Alice", "password": "secret123" }))
        .await;
    assert_eq!(login.status_code(), 200, "login should succeed");
    let login_json = json_body(&login.text());
    let token = login_json["data"]["token"]
        .as_str()
        .expect("token")
        .to_string();
    let user_id = login_json["data"]["user"]["id"]
        .as_str()
        .expect("user id")
        .to_string();

    let (name, value) = auth_header(&token);
    let accounts = request
        .get("/api/v1/accounts")
        .add_header(name.clone(), value.clone())
        .await;
    let account_id = json_body(&accounts.text())["data"][0]["id"]
        .as_str()
        .expect("account id")
        .to_string();

    let categories = request
        .get("/api/v1/categories")
        .add_header(name, value)
        .await;
    let categories = json_body(&categories.text());
    let rows = categories["data"].as_array().expect("categories");
    let expense = rows
        .iter()
        .find(|row| row["kind"] == "expense")
        .expect("expense category");

    let _ = &ctx.db;

    Fixture {
        token,
        user_id,
        account_id,
        expense_category_id: expense["id"].as_str().unwrap().to_string(),
    }
}

/// Registers a user directly (returns token + user id) without touching the
/// default records, useful for building "another user's" fixtures.
pub async fn register_named(request: &TestServer, username: &str) -> (String, String) {
    let response = request
        .post("/api/v1/auth/register")
        .json(&serde_json::json!({ "username": username, "password": "secret123" }))
        .await;
    assert_eq!(response.status_code(), 201, "register {username}");
    let body = json_body(&response.text());
    (
        body["data"]["token"].as_str().unwrap().to_string(),
        body["data"]["user"]["id"].as_str().unwrap().to_string(),
    )
}

pub async fn create_account(
    db: &DatabaseConnection,
    user_id: &str,
    name: &str,
    kind: i32,
) -> accounts::Model {
    let now = time::now_local();
    accounts::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user_id.to_string()),
        name: Set(name.to_string()),
        kind: Set(kind),
        icon: Set(None),
        color: Set(None),
        initial_balance_cents: Set(0),
        currency: Set("HKD".to_string()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .expect("insert account")
}

pub async fn create_category(
    db: &DatabaseConnection,
    user_id: &str,
    name: &str,
    kind: i32,
) -> categories::Model {
    let now = time::now_local();
    categories::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user_id.to_string()),
        name: Set(name.to_string()),
        kind: Set(kind),
        icon: Set(None),
        color: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .expect("insert category")
}

/// A minimal but valid JPEG magic-number payload.
pub fn jpeg_bytes() -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
    bytes.extend_from_slice(&[b'x'; 20]);
    bytes
}

pub fn at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> chrono::NaiveDateTime {
    chrono::NaiveDate::from_ymd_opt(year, month, day)
        .expect("valid date")
        .and_hms_opt(hour, minute, 0)
        .expect("valid time")
}

#[allow(clippy::too_many_arguments)]
pub async fn create_merchant(
    db: &DatabaseConnection,
    user_id: &str,
    name: &str,
    usage_count: i32,
    default_category_id: Option<String>,
) -> merchants::Model {
    let now = time::now_local();
    merchants::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user_id.to_string()),
        name: Set(name.to_string()),
        default_category_id: Set(default_category_id),
        usage_count: Set(usage_count),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .expect("insert merchant")
}

#[allow(clippy::too_many_arguments)]
pub async fn create_transaction(
    db: &DatabaseConnection,
    user_id: &str,
    account_id: &str,
    kind: i32,
    amount_cents: i32,
    occurred_at: chrono::NaiveDateTime,
    category_id: Option<String>,
    merchant_id: Option<String>,
    transfer_account_id: Option<String>,
    source: i32,
) -> transactions::Model {
    let now = time::now_local();
    transactions::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user_id.to_string()),
        account_id: Set(account_id.to_string()),
        category_id: Set(category_id),
        merchant_id: Set(merchant_id),
        kind: Set(kind),
        amount_cents: Set(amount_cents),
        currency: Set("HKD".to_string()),
        occurred_at: Set(occurred_at),
        note: Set(None),
        payment_method: Set(None),
        image_urls: Set(serde_json::json!([])),
        source: Set(source),
        transfer_account_id: Set(transfer_account_id),
        idempotency_key: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .expect("insert transaction")
}

#[allow(clippy::too_many_arguments)]
pub async fn create_rule(
    db: &DatabaseConnection,
    user_id: &str,
    account_id: &str,
    status: i32,
    next_run_at: chrono::NaiveDateTime,
    end_on: Option<chrono::NaiveDate>,
    note: Option<String>,
) -> recurring_rules::Model {
    let now = time::now_local();
    recurring_rules::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user_id.to_string()),
        account_id: Set(account_id.to_string()),
        category_id: Set(None),
        merchant_id: Set(None),
        kind: Set(1),
        amount_cents: Set(1000),
        currency: Set("HKD".to_string()),
        frequency: Set(0),
        interval: Set(1),
        day_of_week: Set(None),
        day_of_month: Set(None),
        month_of_year: Set(None),
        start_on: Set(next_run_at.date()),
        end_on: Set(end_on),
        next_run_at: Set(next_run_at),
        last_run_at: Set(None),
        status: Set(status),
        note: Set(note),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .expect("insert recurring rule")
}

pub async fn create_import_log(
    db: &DatabaseConnection,
    user_id: &str,
    image_sha256: &str,
    parsed_json: Value,
) -> ai_import_logs::Model {
    let now = time::now_local();
    ai_import_logs::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user_id.to_string()),
        image_urls: Set(serde_json::json!(["https://img.eservice-hk.net/a.jpg"])),
        image_sha256: Set(image_sha256.to_string()),
        parse_signature: Set(None),
        provider: Set("deepseek".to_string()),
        model: Set("deepseek-flash".to_string()),
        tokens_in: Set(None),
        tokens_out: Set(None),
        latency_ms: Set(None),
        status: Set(1),
        raw_response: Set(None),
        parsed_json: Set(Some(parsed_json)),
        error_message: Set(None),
        transaction_id: Set(None),
        idempotency_key: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .expect("insert ai import log")
}

pub async fn create_idempotency_key(
    db: &DatabaseConnection,
    user_id: &str,
    key: &str,
    created_at: chrono::NaiveDateTime,
) {
    idempotency_keys::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user_id.to_string()),
        key: Set(key.to_string()),
        request_hash: Set("hash".to_string()),
        response_status: Set(Some(200)),
        response_body: Set(Some("{}".to_string())),
        created_at: Set(created_at),
        updated_at: Set(created_at),
    }
    .insert(db)
    .await
    .expect("insert idempotency key");
}

pub async fn list_transactions(
    db: &DatabaseConnection,
    user_id: &str,
    source: i32,
) -> Vec<transactions::Model> {
    transactions::Entity::find()
        .filter(transactions::Column::UserId.eq(user_id))
        .filter(transactions::Column::Source.eq(source))
        .all(db)
        .await
        .expect("query transactions")
}

pub async fn count_transactions(db: &DatabaseConnection, user_id: &str, source: i32) -> usize {
    list_transactions(db, user_id, source).await.len()
}

pub async fn count_occurrences_without_transaction(
    db: &DatabaseConnection,
    rule_id: &str,
) -> usize {
    recurring_occurrences::Entity::find()
        .filter(recurring_occurrences::Column::RecurringRuleId.eq(rule_id))
        .filter(recurring_occurrences::Column::TransactionId.is_null())
        .all(db)
        .await
        .expect("query occurrences")
        .len()
}

pub async fn count_occurrences(db: &DatabaseConnection, rule_id: &str) -> usize {
    recurring_occurrences::Entity::find()
        .filter(recurring_occurrences::Column::RecurringRuleId.eq(rule_id))
        .all(db)
        .await
        .expect("query occurrences")
        .len()
}

pub async fn find_rule(db: &DatabaseConnection, rule_id: &str) -> recurring_rules::Model {
    recurring_rules::Entity::find_by_id(rule_id.to_string())
        .one(db)
        .await
        .expect("query rule")
        .expect("rule exists")
}

pub async fn find_log(db: &DatabaseConnection, log_id: &str) -> ai_import_logs::Model {
    ai_import_logs::Entity::find_by_id(log_id.to_string())
        .one(db)
        .await
        .expect("query log")
        .expect("log exists")
}
