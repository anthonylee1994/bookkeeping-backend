use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::NaiveDate;
use loco_rs::controller::Routes;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{error::ApiError, time, util, validation::ValidationErrors, ApiResult, AuthUser};
use crate::app::AppContext;
use crate::models::_entities::{
    accounts, categories, merchants, recurring_occurrences, recurring_rules,
};
use crate::services::recurring::{self, RunNowError};
use crate::views;

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/v1")
        .add("/recurring_rules", axum::routing::get(index))
        .add("/recurring_rules", axum::routing::post(create))
        .add("/recurring_rules/{id}", axum::routing::patch(update))
        .add("/recurring_rules/{id}", axum::routing::delete(destroy))
        .add("/recurring_rules/{id}/pause", axum::routing::post(pause))
        .add("/recurring_rules/{id}/resume", axum::routing::post(resume))
        .add(
            "/recurring_rules/{id}/run_now",
            axum::routing::post(run_now),
        )
        .add(
            "/recurring_rules/{id}/skip_next",
            axum::routing::post(skip_next),
        )
}

#[derive(Deserialize)]
struct IndexParams {
    status: Option<String>,
}

async fn find_scoped(
    db: &DatabaseConnection,
    user_id: &str,
    id: &str,
) -> Result<recurring_rules::Model, ApiError> {
    recurring_rules::Entity::find_by_id(id.to_string())
        .filter(recurring_rules::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::not_found)
}

async fn index(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Query(params): Query<IndexParams>,
) -> ApiResult<Response> {
    let mut query =
        recurring_rules::Entity::find().filter(recurring_rules::Column::UserId.eq(user.id()));
    if let Some(status) = params.status.as_deref().filter(|value| !value.is_empty()) {
        match views::parse_status(status) {
            Some(status) => query = query.filter(recurring_rules::Column::Status.eq(status)),
            // Unknown enum values cast to NULL in Rails, which matches nothing.
            None => return Ok(Json(json!({ "data": [] })).into_response()),
        }
    }
    let rows = query
        .order_by_asc(recurring_rules::Column::CreatedAt)
        .all(&ctx.db)
        .await?;
    let data: Vec<Value> = rows.iter().map(views::rule_payload).collect();
    Ok(Json(json!({ "data": data })).into_response())
}

async fn create(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let mut errors = ValidationErrors::new();
    let account_id = body
        .get("account_id")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let category_id = body
        .get("category_id")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let merchant_id = body
        .get("merchant_id")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let kind = parse_enum(&body, "kind", views::parse_transaction_kind)?;
    let frequency = parse_enum(&body, "frequency", views::parse_frequency)?;
    let amount_cents = parse_i32(&body, "amount_cents")?;
    let interval = parse_i32(&body, "interval")?;
    let day_of_week = parse_i32(&body, "day_of_week")?;
    let day_of_month = parse_i32(&body, "day_of_month")?;
    let month_of_year = parse_i32(&body, "month_of_year")?;
    let currency = body
        .get("currency")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let status = parse_enum(&body, "status", views::parse_status)?;
    let note = body
        .get("note")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let start_on = match body.get("start_on").and_then(Value::as_str) {
        Some(value) => time::parse_date(value).ok_or_else(ApiError::invalid_value)?,
        None => {
            errors.add("start_on", "開始日期", "不可為空白");
            return Err(errors.into_api_error());
        }
    };
    let end_on = match body.get("end_on") {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => {
            Some(time::parse_date(value).ok_or_else(ApiError::invalid_value)?)
        }
        Some(_) => return Err(ApiError::invalid_value()),
    };
    let next_run_at = match body.get("next_run_at") {
        None | Some(Value::Null) => time::beginning_of_day(start_on),
        Some(Value::String(value)) => {
            time::parse_datetime(value).ok_or_else(ApiError::invalid_value)?
        }
        Some(_) => return Err(ApiError::invalid_value()),
    };

    if amount_cents.is_none() || amount_cents.unwrap_or(0) <= 0 {
        errors.add("amount_cents", "金額", "必須大於 0");
    }
    if interval.unwrap_or(1) <= 0 {
        errors.add("interval", "間隔", "必須大於 0");
    }
    if let Some(day) = day_of_week {
        if !(0..=6).contains(&day) {
            errors.add("day_of_week", "星期", "不在允許的範圍內");
        }
    }
    if let Some(day) = day_of_month {
        if !(1..=31).contains(&day) {
            errors.add("day_of_month", "日期", "不在允許的範圍內");
        }
    }
    if let Some(month) = month_of_year {
        if !(1..=12).contains(&month) {
            errors.add("month_of_year", "月份", "不在允許的範圍內");
        }
    }
    if kind.is_none() {
        errors.add("kind", "類型", "不可缺少");
    }
    if frequency.is_none() {
        errors.add("frequency", "頻率", "不可缺少");
    }
    validate_ownership(
        &ctx.db,
        user.id(),
        &account_id,
        &category_id,
        &merchant_id,
        &mut errors,
    )
    .await?;
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    let now = time::now_local();
    let rule = recurring_rules::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user.id().to_string()),
        account_id: Set(account_id.unwrap_or_default()),
        category_id: Set(category_id),
        merchant_id: Set(merchant_id),
        kind: Set(kind.unwrap_or(1)),
        amount_cents: Set(amount_cents.unwrap_or(0)),
        currency: Set(currency.unwrap_or_else(|| "HKD".to_string())),
        frequency: Set(frequency.unwrap_or(0)),
        interval: Set(interval.unwrap_or(1)),
        day_of_week: Set(day_of_week),
        day_of_month: Set(day_of_month),
        month_of_year: Set(month_of_year),
        start_on: Set(start_on),
        end_on: Set(end_on),
        next_run_at: Set(next_run_at),
        last_run_at: Set(None),
        status: Set(status.unwrap_or(recurring::STATUS_ACTIVE)),
        note: Set(note),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&ctx.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "data": views::rule_payload(&rule) })),
    )
        .into_response())
}

async fn update(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let rule = find_scoped(&ctx.db, user.id(), &id).await?;

    let mut errors = ValidationErrors::new();
    let account_id = body
        .get("account_id")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let category_id = body
        .get("category_id")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let merchant_id = body
        .get("merchant_id")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let kind = parse_enum(&body, "kind", views::parse_transaction_kind)?;
    let frequency = parse_enum(&body, "frequency", views::parse_frequency)?;
    let amount_cents = parse_i32(&body, "amount_cents")?;
    let interval = parse_i32(&body, "interval")?;
    let day_of_week = parse_i32(&body, "day_of_week")?;
    let day_of_month = parse_i32(&body, "day_of_month")?;
    let month_of_year = parse_i32(&body, "month_of_year")?;
    let currency = body
        .get("currency")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let status = parse_enum(&body, "status", views::parse_status)?;
    let note = body
        .get("note")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let start_on = match body.get("start_on").and_then(Value::as_str) {
        Some(value) => Some(time::parse_date(value).ok_or_else(ApiError::invalid_value)?),
        None => None,
    };
    let end_on = match body.get("end_on") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(value)) => Some(Some(
            time::parse_date(value).ok_or_else(ApiError::invalid_value)?,
        )),
        Some(_) => return Err(ApiError::invalid_value()),
    };
    let next_run_at = match body.get("next_run_at") {
        None => None,
        Some(Value::Null) => None,
        Some(Value::String(value)) => {
            Some(time::parse_datetime(value).ok_or_else(ApiError::invalid_value)?)
        }
        Some(_) => return Err(ApiError::invalid_value()),
    };

    if let Some(amount) = amount_cents {
        if amount <= 0 {
            errors.add("amount_cents", "金額", "必須大於 0");
        }
    }
    if let Some(interval) = interval {
        if interval <= 0 {
            errors.add("interval", "間隔", "必須大於 0");
        }
    }
    if let Some(day) = day_of_week {
        if !(0..=6).contains(&day) {
            errors.add("day_of_week", "星期", "不在允許的範圍內");
        }
    }
    if let Some(day) = day_of_month {
        if !(1..=31).contains(&day) {
            errors.add("day_of_month", "日期", "不在允許的範圍內");
        }
    }
    if let Some(month) = month_of_year {
        if !(1..=12).contains(&month) {
            errors.add("month_of_year", "月份", "不在允許的範圍內");
        }
    }
    let effective_account = account_id
        .clone()
        .unwrap_or_else(|| rule.account_id.clone());
    validate_ownership(
        &ctx.db,
        user.id(),
        &Some(effective_account),
        &category_id.clone().or_else(|| rule.category_id.clone()),
        &merchant_id.clone().or_else(|| rule.merchant_id.clone()),
        &mut errors,
    )
    .await?;
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    let mut active: recurring_rules::ActiveModel = rule.into();
    if let Some(value) = account_id {
        active.account_id = Set(value);
    }
    if body.get("category_id").is_some() {
        active.category_id = Set(category_id);
    }
    if body.get("merchant_id").is_some() {
        active.merchant_id = Set(merchant_id);
    }
    if let Some(value) = kind {
        active.kind = Set(value);
    }
    if let Some(value) = amount_cents {
        active.amount_cents = Set(value);
    }
    if let Some(value) = currency {
        active.currency = Set(value);
    }
    if let Some(value) = frequency {
        active.frequency = Set(value);
    }
    if let Some(value) = interval {
        active.interval = Set(value);
    }
    if let Some(value) = day_of_week {
        active.day_of_week = Set(Some(value));
    }
    if let Some(value) = day_of_month {
        active.day_of_month = Set(Some(value));
    }
    if let Some(value) = month_of_year {
        active.month_of_year = Set(Some(value));
    }
    if let Some(value) = start_on {
        active.start_on = Set(value);
    }
    if let Some(value) = end_on {
        active.end_on = Set(value);
    }
    if let Some(value) = next_run_at {
        active.next_run_at = Set(value);
    }
    if let Some(value) = status {
        active.status = Set(value);
    }
    if body.get("note").is_some() {
        active.note = Set(note);
    }
    active.updated_at = Set(time::now_local());
    let rule = active.update(&ctx.db).await?;

    Ok(Json(json!({ "data": views::rule_payload(&rule) })).into_response())
}

async fn destroy(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let rule = find_scoped(&ctx.db, user.id(), &id).await?;
    recurring_occurrences::Entity::delete_many()
        .filter(recurring_occurrences::Column::RecurringRuleId.eq(&rule.id))
        .exec(&ctx.db)
        .await?;
    recurring_rules::Entity::delete_by_id(rule.id)
        .exec(&ctx.db)
        .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn pause(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    set_status(&ctx, &user, &id, recurring::STATUS_PAUSED).await
}

async fn resume(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let rule = find_scoped(&ctx.db, user.id(), &id).await?;
    let now = time::now_local();
    let next_run_at = rule.next_run_at.max(now);
    let mut active: recurring_rules::ActiveModel = rule.into();
    active.status = Set(recurring::STATUS_ACTIVE);
    active.next_run_at = Set(next_run_at);
    active.updated_at = Set(now);
    let rule = active.update(&ctx.db).await?;
    Ok(Json(json!({ "data": views::rule_payload(&rule) })).into_response())
}

async fn set_status(
    ctx: &AppContext,
    user: &AuthUser,
    id: &str,
    status: i32,
) -> ApiResult<Response> {
    let rule = find_scoped(&ctx.db, user.id(), id).await?;
    let mut active: recurring_rules::ActiveModel = rule.into();
    active.status = Set(status);
    active.updated_at = Set(time::now_local());
    let rule = active.update(&ctx.db).await?;
    Ok(Json(json!({ "data": views::rule_payload(&rule) })).into_response())
}

async fn run_now(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let rule = find_scoped(&ctx.db, user.id(), &id).await?;
    match recurring::run_now(&ctx.db, user.id(), &rule).await {
        Ok(Some(transaction)) => Ok(Json(json!({
            "data": views::transaction_payload_with_net(&transaction, false)
        }))
        .into_response()),
        Ok(None) => Err(ApiError::internal()),
        Err(RunNowError::AlreadyMaterialized) => Err(ApiError::already_materialized()),
        Err(RunNowError::Db(err)) => Err(ApiError::from(err)),
    }
}

async fn skip_next(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let rule = find_scoped(&ctx.db, user.id(), &id).await?;
    let rule = recurring::skip_next(&ctx.db, &rule).await?;
    Ok(Json(json!({ "data": views::rule_payload(&rule) })).into_response())
}

fn parse_enum(
    body: &Value,
    key: &str,
    parser: fn(&str) -> Option<i32>,
) -> Result<Option<i32>, ApiError> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => parser(value).map(Some).ok_or_else(ApiError::invalid_value),
        Some(_) => Err(ApiError::invalid_value()),
    }
}

fn parse_i32(body: &Value, key: &str) -> Result<Option<i32>, ApiError> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => number
            .as_i64()
            .and_then(|value| i32::try_from(value).ok())
            .map(Some)
            .ok_or_else(ApiError::invalid_value),
        Some(Value::String(value)) => value
            .trim()
            .parse::<i32>()
            .map(Some)
            .map_err(|_| ApiError::invalid_value()),
        Some(_) => Err(ApiError::invalid_value()),
    }
}

async fn validate_ownership(
    db: &DatabaseConnection,
    user_id: &str,
    account_id: &Option<String>,
    category_id: &Option<String>,
    merchant_id: &Option<String>,
    errors: &mut ValidationErrors,
) -> Result<(), ApiError> {
    match account_id {
        Some(id) if !id.is_empty() => {
            if accounts::Entity::find_by_id(id.clone())
                .filter(accounts::Column::UserId.eq(user_id))
                .one(db)
                .await?
                .is_none()
            {
                errors.add("account", "帳戶", "無效");
            }
        }
        _ => errors.add("account", "帳戶", "不可缺少"),
    }
    if let Some(id) = category_id {
        if categories::Entity::find_by_id(id.clone())
            .filter(categories::Column::UserId.eq(user_id))
            .one(db)
            .await?
            .is_none()
        {
            errors.add("category", "分類", "無效");
        }
    }
    if let Some(id) = merchant_id {
        if merchants::Entity::find_by_id(id.clone())
            .filter(merchants::Column::UserId.eq(user_id))
            .one(db)
            .await?
            .is_none()
        {
            errors.add("merchant", "商家", "無效");
        }
    }
    Ok(())
}

#[allow(dead_code)]
fn _unused_date(_: NaiveDate) {}
