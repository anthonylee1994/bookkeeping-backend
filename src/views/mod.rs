use sea_orm::entity::prelude::Json;
use serde_json::{json, Value};

use crate::api::time;
use crate::models::_entities::{
    accounts, ai_import_logs, categories, merchants, recurring_rules, transactions, users,
};

pub fn account_kind_name(kind: i32) -> &'static str {
    match kind {
        0 => "cash",
        1 => "bank",
        2 => "credit_card",
        3 => "e_wallet",
        _ => "other",
    }
}

pub fn parse_account_kind(value: &str) -> Option<i32> {
    match value {
        "cash" => Some(0),
        "bank" => Some(1),
        "credit_card" => Some(2),
        "e_wallet" => Some(3),
        "other" => Some(4),
        _ => None,
    }
}

pub fn category_kind_name(kind: i32) -> &'static str {
    match kind {
        0 => "income",
        _ => "expense",
    }
}

pub fn parse_category_kind(value: &str) -> Option<i32> {
    match value {
        "income" => Some(0),
        "expense" => Some(1),
        _ => None,
    }
}

pub fn transaction_kind_name(kind: i32) -> &'static str {
    match kind {
        0 => "income",
        1 => "expense",
        _ => "transfer",
    }
}

pub fn parse_transaction_kind(value: &str) -> Option<i32> {
    match value {
        "income" => Some(0),
        "expense" => Some(1),
        "transfer" => Some(2),
        _ => None,
    }
}

pub fn transaction_source_name(source: i32) -> &'static str {
    match source {
        1 => "recurring",
        2 => "ai",
        3 => "import",
        _ => "manual",
    }
}

pub fn parse_transaction_source(value: &str) -> Option<i32> {
    match value {
        "manual" => Some(0),
        "recurring" => Some(1),
        "ai" => Some(2),
        "import" => Some(3),
        _ => None,
    }
}

pub fn frequency_name(frequency: i32) -> &'static str {
    match frequency {
        0 => "daily",
        1 => "weekly",
        2 => "monthly",
        _ => "yearly",
    }
}

pub fn parse_frequency(value: &str) -> Option<i32> {
    match value {
        "daily" => Some(0),
        "weekly" => Some(1),
        "monthly" => Some(2),
        "yearly" => Some(3),
        _ => None,
    }
}

pub fn status_name(status: i32) -> &'static str {
    match status {
        1 => "paused",
        2 => "ended",
        _ => "active",
    }
}

pub fn parse_status(value: &str) -> Option<i32> {
    match value {
        "active" => Some(0),
        "paused" => Some(1),
        "ended" => Some(2),
        _ => None,
    }
}

pub fn ai_status_name(status: i32) -> &'static str {
    match status {
        1 => "success",
        2 => "failed",
        3 => "partial",
        _ => "pending",
    }
}

pub fn user_payload(user: &users::Model) -> Value {
    json!({
        "id": user.id,
        "username": user.username,
        "timezone": user.timezone,
        "currency": user.currency,
    })
}

pub fn account_payload(account: &accounts::Model) -> Value {
    json!({
        "id": account.id,
        "name": account.name,
        "kind": account_kind_name(account.kind),
        "icon": account.icon,
        "color": account.color,
        "initial_balance_cents": account.initial_balance_cents,
        "currency": account.currency,
        "created_at": time::format_datetime(&account.created_at),
        "updated_at": time::format_datetime(&account.updated_at),
    })
}

pub fn category_payload(category: &categories::Model) -> Value {
    json!({
        "id": category.id,
        "name": category.name,
        "kind": category_kind_name(category.kind),
        "icon": category.icon,
        "color": category.color,
        "created_at": time::format_datetime(&category.created_at),
        "updated_at": time::format_datetime(&category.updated_at),
    })
}

pub fn merchant_payload(merchant: &merchants::Model) -> Value {
    json!({
        "id": merchant.id,
        "name": merchant.name,
        "default_category_id": merchant.default_category_id,
        "usage_count": merchant.usage_count,
        "created_at": time::format_datetime(&merchant.created_at),
        "updated_at": time::format_datetime(&merchant.updated_at),
    })
}

fn image_urls_value(image_urls: &Json) -> Value {
    image_urls.clone()
}

pub fn transaction_payload(transaction: &transactions::Model) -> Value {
    json!({
        "id": transaction.id,
        "user_id": transaction.user_id,
        "account_id": transaction.account_id,
        "category_id": transaction.category_id,
        "merchant_id": transaction.merchant_id,
        "kind": transaction_kind_name(transaction.kind),
        "amount_cents": transaction.amount_cents,
        "currency": transaction.currency,
        "occurred_at": time::format_datetime(&transaction.occurred_at),
        "note": transaction.note,
        "payment_method": transaction.payment_method,
        "image_urls": image_urls_value(&transaction.image_urls),
        "source": transaction_source_name(transaction.source),
        "transfer_account_id": transaction.transfer_account_id,
        "created_at": time::format_datetime(&transaction.created_at),
        "updated_at": time::format_datetime(&transaction.updated_at),
    })
}

/// Rows used by dashboard + summaries (no `user_id` / timestamps).
pub fn transaction_row(transaction: &transactions::Model) -> Value {
    json!({
        "id": transaction.id,
        "account_id": transaction.account_id,
        "category_id": transaction.category_id,
        "merchant_id": transaction.merchant_id,
        "kind": transaction_kind_name(transaction.kind),
        "amount_cents": transaction.amount_cents,
        "currency": transaction.currency,
        "occurred_at": time::format_datetime(&transaction.occurred_at),
        "note": transaction.note,
        "payment_method": transaction.payment_method,
        "image_urls": image_urls_value(&transaction.image_urls),
        "source": transaction_source_name(transaction.source),
        "transfer_account_id": transaction.transfer_account_id,
    })
}

/// Legacy payload used by `run_now` / `ai.confirm`: includes
/// `net_amount_cents` (equal to `amount_cents`).
pub fn transaction_payload_with_net(
    transaction: &transactions::Model,
    include_image_urls: bool,
) -> Value {
    let mut value = json!({
        "id": transaction.id,
        "account_id": transaction.account_id,
        "category_id": transaction.category_id,
        "merchant_id": transaction.merchant_id,
        "kind": transaction_kind_name(transaction.kind),
        "amount_cents": transaction.amount_cents,
        "currency": transaction.currency,
        "occurred_at": time::format_datetime(&transaction.occurred_at),
        "note": transaction.note,
        "source": transaction_source_name(transaction.source),
        "net_amount_cents": transaction.amount_cents,
    });
    if include_image_urls {
        value["image_urls"] = image_urls_value(&transaction.image_urls);
    }
    value
}

pub fn rule_payload(rule: &recurring_rules::Model) -> Value {
    json!({
        "id": rule.id,
        "account_id": rule.account_id,
        "category_id": rule.category_id,
        "merchant_id": rule.merchant_id,
        "kind": transaction_kind_name(rule.kind),
        "amount_cents": rule.amount_cents,
        "currency": rule.currency,
        "frequency": frequency_name(rule.frequency),
        "interval": rule.interval,
        "day_of_week": rule.day_of_week,
        "day_of_month": rule.day_of_month,
        "month_of_year": rule.month_of_year,
        "start_on": time::format_date(&rule.start_on),
        "end_on": time::format_date_opt(&rule.end_on),
        "next_run_at": time::format_datetime(&rule.next_run_at),
        "last_run_at": time::format_datetime_opt(&rule.last_run_at),
        "status": status_name(rule.status),
        "note": rule.note,
        "created_at": time::format_datetime(&rule.created_at),
        "updated_at": time::format_datetime(&rule.updated_at),
    })
}

pub struct AiPayloadInput<'a> {
    pub log: &'a ai_import_logs::Model,
    pub parsed: Value,
    pub suggested_category_id: Option<String>,
}

pub fn ai_payload(input: AiPayloadInput<'_>) -> Value {
    json!({
        "id": input.log.id,
        "image_urls": image_urls_value(&input.log.image_urls),
        "sha256": input.log.image_sha256,
        "status": ai_status_name(input.log.status),
        "parsed": input.parsed,
        "suggested_category_id": input.suggested_category_id,
        "raw_response": input.log.raw_response,
        "error": input.log.error_message,
        "tokens_in": input.log.tokens_in,
        "tokens_out": input.log.tokens_out,
        "latency_ms": input.log.latency_ms,
    })
}
