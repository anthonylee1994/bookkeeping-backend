use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{NaiveDate, NaiveDateTime};
use loco_rs::controller::Routes;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{
    error::ApiError, params, time, util, validation::ValidationErrors, ApiResult, AuthUser,
};
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

/// Parsed recurring-rule request body. `*_touched` flags and the nested
/// `Option`s on `end_on`/`next_run_at` distinguish "not provided" from
/// "explicitly null", so the same parser serves both create and update.
struct RuleFields {
    account_id: Option<String>,
    category_id: Option<String>,
    category_touched: bool,
    merchant_id: Option<String>,
    merchant_touched: bool,
    kind: Option<i32>,
    frequency: Option<i32>,
    amount_cents: Option<i32>,
    interval: Option<i32>,
    day_of_week: Option<i32>,
    day_of_month: Option<i32>,
    month_of_year: Option<i32>,
    currency: Option<String>,
    status: Option<i32>,
    note: Option<String>,
    note_touched: bool,
    start_on: Option<NaiveDate>,
    end_on: Option<Option<NaiveDate>>,
    next_run_at: Option<NaiveDateTime>,
}

impl RuleFields {
    fn from_request(body: &Value) -> Result<Self, ApiError> {
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

        Ok(Self {
            account_id: params::string_field(body, "account_id"),
            category_touched: params::touched(body, "category_id"),
            category_id: params::string_field(body, "category_id"),
            merchant_touched: params::touched(body, "merchant_id"),
            merchant_id: params::string_field(body, "merchant_id"),
            kind: params::parse_enum_field(body, "kind", views::parse_transaction_kind)?,
            frequency: params::parse_enum_field(body, "frequency", views::parse_frequency)?,
            amount_cents: params::parse_i32_field(body, "amount_cents")?,
            interval: params::parse_i32_field(body, "interval")?,
            day_of_week: params::parse_i32_field(body, "day_of_week")?,
            day_of_month: params::parse_i32_field(body, "day_of_month")?,
            month_of_year: params::parse_i32_field(body, "month_of_year")?,
            currency: params::string_field(body, "currency"),
            status: params::parse_enum_field(body, "status", views::parse_status)?,
            note_touched: params::touched(body, "note"),
            note: params::string_field(body, "note"),
            start_on,
            end_on,
            next_run_at: params::parse_datetime_field(body, "next_run_at")?,
        })
    }
}

/// Range checks shared by create and update; both treat a missing interval as
/// `1`, which is always valid.
fn validate_field_ranges(fields: &RuleFields, errors: &mut ValidationErrors) {
    if fields.interval.unwrap_or(1) <= 0 {
        errors.add("interval", "間隔", "必須大於 0");
    }
    if let Some(day) = fields.day_of_week {
        if !(0..=6).contains(&day) {
            errors.add("day_of_week", "星期", "不在允許的範圍內");
        }
    }
    if let Some(day) = fields.day_of_month {
        if !(1..=31).contains(&day) {
            errors.add("day_of_month", "日期", "不在允許的範圍內");
        }
    }
    if let Some(month) = fields.month_of_year {
        if !(1..=12).contains(&month) {
            errors.add("month_of_year", "月份", "不在允許的範圍內");
        }
    }
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
    let fields = RuleFields::from_request(&body)?;

    let mut errors = ValidationErrors::new();
    let Some(start_on) = fields.start_on else {
        errors.add("start_on", "開始日期", "不可為空白");
        return Err(errors.into_api_error());
    };

    if fields.amount_cents.is_none() || fields.amount_cents.unwrap_or(0) <= 0 {
        errors.add("amount_cents", "金額", "必須大於 0");
    }
    validate_field_ranges(&fields, &mut errors);
    if fields.kind.is_none() {
        errors.add("kind", "類型", "不可缺少");
    }
    if fields.frequency.is_none() {
        errors.add("frequency", "頻率", "不可缺少");
    }
    validate_ownership(
        &ctx.db,
        user.id(),
        &fields.account_id,
        &fields.category_id,
        &fields.merchant_id,
        &mut errors,
    )
    .await?;
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    let now = time::now_local();
    let next_run_at = fields
        .next_run_at
        .unwrap_or_else(|| time::beginning_of_day(start_on));
    let rule = recurring_rules::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user.id().to_string()),
        account_id: Set(fields.account_id.clone().unwrap_or_default()),
        category_id: Set(fields.category_id.clone()),
        merchant_id: Set(fields.merchant_id.clone()),
        kind: Set(fields.kind.unwrap_or(1)),
        amount_cents: Set(fields.amount_cents.unwrap_or(0)),
        currency: Set(fields.currency.clone().unwrap_or_else(|| "HKD".to_string())),
        frequency: Set(fields.frequency.unwrap_or(0)),
        interval: Set(fields.interval.unwrap_or(1)),
        day_of_week: Set(fields.day_of_week),
        day_of_month: Set(fields.day_of_month),
        month_of_year: Set(fields.month_of_year),
        start_on: Set(start_on),
        end_on: Set(fields.end_on.flatten()),
        next_run_at: Set(next_run_at),
        last_run_at: Set(None),
        status: Set(fields.status.unwrap_or(recurring::STATUS_ACTIVE)),
        note: Set(fields.note.clone()),
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
    let fields = RuleFields::from_request(&body)?;

    let mut errors = ValidationErrors::new();
    if let Some(amount) = fields.amount_cents {
        if amount <= 0 {
            errors.add("amount_cents", "金額", "必須大於 0");
        }
    }
    validate_field_ranges(&fields, &mut errors);

    let effective_account = fields
        .account_id
        .clone()
        .unwrap_or_else(|| rule.account_id.clone());
    validate_ownership(
        &ctx.db,
        user.id(),
        &Some(effective_account),
        &fields
            .category_id
            .clone()
            .or_else(|| rule.category_id.clone()),
        &fields
            .merchant_id
            .clone()
            .or_else(|| rule.merchant_id.clone()),
        &mut errors,
    )
    .await?;
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    let mut active: recurring_rules::ActiveModel = rule.into();
    if let Some(value) = fields.account_id {
        active.account_id = Set(value);
    }
    if fields.category_touched {
        active.category_id = Set(fields.category_id);
    }
    if fields.merchant_touched {
        active.merchant_id = Set(fields.merchant_id);
    }
    if let Some(value) = fields.kind {
        active.kind = Set(value);
    }
    if let Some(value) = fields.amount_cents {
        active.amount_cents = Set(value);
    }
    if let Some(value) = fields.currency {
        active.currency = Set(value);
    }
    if let Some(value) = fields.frequency {
        active.frequency = Set(value);
    }
    if let Some(value) = fields.interval {
        active.interval = Set(value);
    }
    if let Some(value) = fields.day_of_week {
        active.day_of_week = Set(Some(value));
    }
    if let Some(value) = fields.day_of_month {
        active.day_of_month = Set(Some(value));
    }
    if let Some(value) = fields.month_of_year {
        active.month_of_year = Set(Some(value));
    }
    if let Some(value) = fields.start_on {
        active.start_on = Set(value);
    }
    if let Some(value) = fields.end_on {
        active.end_on = Set(value);
    }
    if let Some(value) = fields.next_run_at {
        active.next_run_at = Set(value);
    }
    if let Some(value) = fields.status {
        active.status = Set(value);
    }
    if fields.note_touched {
        active.note = Set(fields.note);
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
