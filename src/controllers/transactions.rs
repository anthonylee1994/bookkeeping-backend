use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::NaiveDateTime;
use loco_rs::controller::Routes;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, DatabaseConnection, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{
    error::ApiError, idempotency, time, util, validation::ValidationErrors, ApiResult, AuthUser,
};
use crate::app::AppContext;
use crate::models::_entities::{
    accounts, ai_import_logs, categories, merchants, recurring_occurrences, transactions,
};
use crate::views;

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/v1")
        .add("/transactions", axum::routing::get(index))
        .add("/transactions", axum::routing::post(create))
        .add("/transactions/{id}", axum::routing::get(show))
        .add("/transactions/{id}", axum::routing::patch(update))
        .add("/transactions/{id}", axum::routing::delete(destroy))
        .add(
            "/transactions/{id}/duplicate",
            axum::routing::post(duplicate),
        )
}

const KIND_EXPENSE: i32 = 1;
const KIND_TRANSFER: i32 = 2;

#[derive(Deserialize)]
struct IndexParams {
    from: Option<String>,
    to: Option<String>,
    kind: Option<String>,
    category_id: Option<String>,
    account_id: Option<String>,
    merchant_id: Option<String>,
    q: Option<String>,
    min_amount: Option<String>,
    max_amount: Option<String>,
    sort: Option<String>,
    page: Option<String>,
    per_page: Option<String>,
}

async fn find_scoped(
    db: &DatabaseConnection,
    user_id: &str,
    id: &str,
) -> Result<transactions::Model, ApiError> {
    transactions::Entity::find_by_id(id.to_string())
        .filter(transactions::Column::UserId.eq(user_id))
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
    let mut query = transactions::Entity::find().filter(transactions::Column::UserId.eq(user.id()));

    if let (Some(from), Some(to)) = (params.from.as_deref(), params.to.as_deref()) {
        let from = time::parse_datetime(from).ok_or_else(ApiError::invalid_value)?;
        let to = time::parse_datetime(to).ok_or_else(ApiError::invalid_value)?;
        query =
            query.filter(transactions::Column::OccurredAt.gte(time::beginning_of_day(from.date())));
        query = query.filter(transactions::Column::OccurredAt.lte(time::end_of_day(to.date())));
    }

    if let Some(kind) = params.kind.as_deref().filter(|value| !value.is_empty()) {
        match views::parse_transaction_kind(kind) {
            Some(kind) => query = query.filter(transactions::Column::Kind.eq(kind)),
            // Unknown enum values cast to NULL in Rails, which matches nothing.
            None => query = query.filter(transactions::Column::Kind.is_null()),
        }
    }

    if let Some(value) = params
        .category_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        query = query.filter(transactions::Column::CategoryId.eq(value));
    }
    if let Some(value) = params
        .account_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        query = query.filter(transactions::Column::AccountId.eq(value));
    }
    if let Some(value) = params
        .merchant_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        query = query.filter(transactions::Column::MerchantId.eq(value));
    }

    if let Some(q) = params.q.as_deref().filter(|value| !value.is_empty()) {
        let pattern = format!("%{}%", util::sanitize_like(q));
        query = query.left_join(merchants::Entity).filter(
            Condition::any()
                .add(transactions::Column::Note.like(pattern.clone()))
                .add(transactions::Column::PaymentMethod.like(pattern.clone()))
                .add(merchants::Column::Name.like(pattern)),
        );
    }

    if let Some(value) = params
        .min_amount
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let min = value
            .trim()
            .parse::<i32>()
            .map_err(|_| ApiError::invalid_value())?;
        query = query.filter(transactions::Column::AmountCents.gte(min));
    }
    if let Some(value) = params
        .max_amount
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let max = value
            .trim()
            .parse::<i32>()
            .map_err(|_| ApiError::invalid_value())?;
        query = query.filter(transactions::Column::AmountCents.lte(max));
    }

    let sort = params.sort.clone().unwrap_or_default();
    let (column, descending) = match sort.strip_prefix('-') {
        Some(stripped) if matches!(stripped, "occurred_at" | "amount_cents" | "created_at") => {
            (stripped.to_string(), true)
        }
        _ if matches!(sort.as_str(), "occurred_at" | "amount_cents" | "created_at") => {
            (sort.clone(), false)
        }
        _ => ("occurred_at".to_string(), false),
    };

    let page = util::clamp_page(params.page.as_deref());
    let per_page = util::clamp_per_page(params.per_page.as_deref());

    let total = query.clone().count(&ctx.db).await? as i64;

    let order = if descending {
        sea_orm::Order::Desc
    } else {
        sea_orm::Order::Asc
    };
    let query = match column.as_str() {
        "amount_cents" => query.order_by(transactions::Column::AmountCents, order),
        "created_at" => query.order_by(transactions::Column::CreatedAt, order),
        _ => query.order_by(transactions::Column::OccurredAt, order),
    };

    let rows = query
        .offset(((page - 1) * per_page) as u64)
        .limit(per_page as u64)
        .all(&ctx.db)
        .await?;

    let data: Vec<Value> = rows.iter().map(views::transaction_payload).collect();
    let total_pages = ((total as f64) / (per_page as f64)).ceil() as i64;
    Ok(Json(json!({
        "data": data,
        "meta": { "page": page, "per_page": per_page, "total": total, "total_pages": total_pages }
    }))
    .into_response())
}

async fn create(
    user: AuthUser,
    State(ctx): State<AppContext>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let raw = body.to_vec();
    let response = idempotency::wrap(
        &ctx.db,
        user.id(),
        &headers,
        "POST",
        "/api/v1/transactions",
        &raw,
        || async {
            match do_create(&ctx, &user, &raw).await {
                Ok((status, value)) => (status, value),
                Err(err) => (err.status, err.body_value()),
            }
        },
    )
    .await;
    Ok(response)
}

async fn do_create(
    ctx: &AppContext,
    user: &AuthUser,
    raw: &[u8],
) -> Result<(StatusCode, Value), ApiError> {
    let body = parse_json(raw)?;
    let transaction = create_validated(&ctx.db, user.id(), &body, None).await?;

    if let Some(merchant_id) = &transaction.merchant_id {
        if let Some(merchant) = merchants::Entity::find_by_id(merchant_id.clone())
            .one(&ctx.db)
            .await?
        {
            let usage_count = merchant.usage_count + 1;
            let mut active: merchants::ActiveModel = merchant.into();
            active.usage_count = Set(usage_count);
            active.updated_at = Set(time::now_local());
            active.update(&ctx.db).await?;
        }
    }

    Ok((
        StatusCode::CREATED,
        json!({ "data": views::transaction_payload(&transaction) }),
    ))
}

/// Shared create path used by `POST /transactions` and `POST /ai/confirm`.
pub async fn create_validated(
    db: &DatabaseConnection,
    user_id: &str,
    body: &Value,
    source_override: Option<i32>,
) -> Result<transactions::Model, ApiError> {
    let fields = ValidatedFields::from_request(db, user_id, body, None).await?;
    let now = time::now_local();

    transactions::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user_id.to_string()),
        account_id: Set(fields.account_id.clone().unwrap_or_default()),
        category_id: Set(fields.category_id.clone()),
        merchant_id: Set(fields.merchant_id.clone()),
        kind: Set(fields.kind.unwrap_or(KIND_EXPENSE)),
        amount_cents: Set(fields.amount_cents.unwrap_or(0)),
        currency: Set(fields.currency.clone().unwrap_or_else(|| "HKD".to_string())),
        occurred_at: Set(fields.occurred_at.unwrap_or(now)),
        note: Set(fields.note.clone()),
        payment_method: Set(fields.payment_method.clone()),
        image_urls: Set(serde_json::json!(fields.image_urls.clone())),
        source: Set(source_override.or(fields.source).unwrap_or(0)),
        transfer_account_id: Set(fields.transfer_account_id.clone()),
        idempotency_key: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .map_err(ApiError::from)
}

async fn show(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let transaction = find_scoped(&ctx.db, user.id(), &id).await?;
    Ok(Json(json!({ "data": views::transaction_payload(&transaction) })).into_response())
}

async fn update(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let transaction = find_scoped(&ctx.db, user.id(), &id).await?;
    let fields =
        ValidatedFields::from_request(&ctx.db, user.id(), &body, Some(&transaction)).await?;

    let mut active: transactions::ActiveModel = transaction.into();
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
    if let Some(value) = fields.occurred_at {
        active.occurred_at = Set(value);
    }
    if fields.note_touched {
        active.note = Set(fields.note);
    }
    if fields.payment_method_touched {
        active.payment_method = Set(fields.payment_method);
    }
    if fields.image_urls_touched {
        active.image_urls = Set(serde_json::json!(fields.image_urls));
    }
    if let Some(value) = fields.source {
        active.source = Set(value);
    }
    if fields.transfer_account_touched {
        active.transfer_account_id = Set(fields.transfer_account_id);
    }
    active.updated_at = Set(time::now_local());
    let transaction = active.update(&ctx.db).await?;

    Ok(Json(json!({ "data": views::transaction_payload(&transaction) })).into_response())
}

async fn destroy(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let transaction = find_scoped(&ctx.db, user.id(), &id).await?;

    recurring_occurrences::Entity::update_many()
        .col_expr(
            recurring_occurrences::Column::TransactionId,
            sea_orm::sea_query::Expr::value(Option::<String>::None),
        )
        .filter(recurring_occurrences::Column::TransactionId.eq(&transaction.id))
        .exec(&ctx.db)
        .await?;
    ai_import_logs::Entity::update_many()
        .col_expr(
            ai_import_logs::Column::TransactionId,
            sea_orm::sea_query::Expr::value(Option::<String>::None),
        )
        .filter(ai_import_logs::Column::TransactionId.eq(&transaction.id))
        .exec(&ctx.db)
        .await?;

    transactions::Entity::delete_by_id(transaction.id)
        .exec(&ctx.db)
        .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn duplicate(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let original = find_scoped(&ctx.db, user.id(), &id).await?;
    let now = time::now_local();

    let copy = transactions::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(original.user_id.clone()),
        account_id: Set(original.account_id.clone()),
        category_id: Set(original.category_id.clone()),
        merchant_id: Set(original.merchant_id.clone()),
        kind: Set(original.kind),
        amount_cents: Set(original.amount_cents),
        currency: Set(original.currency.clone()),
        occurred_at: Set(now),
        note: Set(original.note.clone()),
        payment_method: Set(original.payment_method.clone()),
        image_urls: Set(original.image_urls.clone()),
        source: Set(original.source),
        transfer_account_id: Set(original.transfer_account_id.clone()),
        idempotency_key: Set(original.idempotency_key.clone()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&ctx.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "data": views::transaction_payload(&copy) })),
    )
        .into_response())
}

fn parse_json(raw: &[u8]) -> Result<Value, ApiError> {
    serde_json::from_slice::<Value>(raw).map_err(|_| ApiError::invalid_value())
}

/// Validated transaction fields. `*_touched` flags distinguish "not provided"
/// from "explicitly set to null" for nullable associations.
struct ValidatedFields {
    account_id: Option<String>,
    category_id: Option<String>,
    category_touched: bool,
    merchant_id: Option<String>,
    merchant_touched: bool,
    kind: Option<i32>,
    amount_cents: Option<i32>,
    currency: Option<String>,
    occurred_at: Option<NaiveDateTime>,
    note: Option<String>,
    note_touched: bool,
    payment_method: Option<String>,
    payment_method_touched: bool,
    image_urls: Vec<String>,
    image_urls_touched: bool,
    source: Option<i32>,
    transfer_account_id: Option<String>,
    transfer_account_touched: bool,
}

impl ValidatedFields {
    async fn from_request(
        db: &DatabaseConnection,
        user_id: &str,
        body: &Value,
        existing: Option<&transactions::Model>,
    ) -> Result<Self, ApiError> {
        let field = |key: &str| body.get(key);

        let account_id = field("account_id")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let category_touched = field("category_id").is_some();
        let category_id = field("category_id")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let merchant_touched = field("merchant_id").is_some();
        let merchant_id = field("merchant_id")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let transfer_touched = field("transfer_account_id").is_some();
        let transfer_account_id = field("transfer_account_id")
            .and_then(Value::as_str)
            .map(ToString::to_string);

        let kind = parse_enum_field(body, "kind", views::parse_transaction_kind)?;
        let source = parse_enum_field(body, "source", views::parse_transaction_source)?;
        let amount_cents = parse_i32_field(body, "amount_cents")?;
        let currency = field("currency")
            .and_then(Value::as_str)
            .map(ToString::to_string);

        let occurred_at = match field("occurred_at") {
            None | Some(Value::Null) => None,
            Some(Value::String(value)) => {
                Some(time::parse_datetime(value).ok_or_else(ApiError::invalid_value)?)
            }
            Some(_) => return Err(ApiError::invalid_value()),
        };

        let note_touched = field("note").is_some();
        let note = field("note")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let payment_method_touched = field("payment_method").is_some();
        let payment_method = field("payment_method")
            .and_then(Value::as_str)
            .map(ToString::to_string);

        let image_urls_touched = field("image_urls").is_some();
        let image_urls = match field("image_urls") {
            None => Vec::new(),
            Some(Value::Array(items)) => {
                let mut urls = Vec::with_capacity(items.len());
                for item in items {
                    match item.as_str() {
                        Some(url) => urls.push(url.to_string()),
                        None => return Err(image_urls_error()),
                    }
                }
                urls
            }
            Some(_) => return Err(image_urls_error()),
        };

        let effective = EffectiveValues {
            account_id: account_id
                .clone()
                .or_else(|| existing.map(|t| t.account_id.clone())),
            category_id: if category_touched {
                category_id.clone()
            } else {
                existing.and_then(|t| t.category_id.clone())
            },
            merchant_id: if merchant_touched {
                merchant_id.clone()
            } else {
                existing.and_then(|t| t.merchant_id.clone())
            },
            kind: kind.or_else(|| existing.map(|t| t.kind)),
            amount_cents: amount_cents.or_else(|| existing.map(|t| t.amount_cents)),
            occurred_at: occurred_at.or_else(|| existing.map(|t| t.occurred_at)),
            transfer_account_id: if transfer_touched {
                transfer_account_id.clone()
            } else {
                existing.and_then(|t| t.transfer_account_id.clone())
            },
        };

        validate_effective(db, user_id, &effective).await?;

        Ok(Self {
            account_id,
            category_id,
            category_touched,
            merchant_id,
            merchant_touched,
            kind,
            amount_cents,
            currency,
            occurred_at,
            note,
            note_touched,
            payment_method,
            payment_method_touched,
            image_urls,
            image_urls_touched,
            source,
            transfer_account_id,
            transfer_account_touched: transfer_touched,
        })
    }
}

struct EffectiveValues {
    account_id: Option<String>,
    category_id: Option<String>,
    merchant_id: Option<String>,
    kind: Option<i32>,
    amount_cents: Option<i32>,
    occurred_at: Option<NaiveDateTime>,
    transfer_account_id: Option<String>,
}

async fn validate_effective(
    db: &DatabaseConnection,
    user_id: &str,
    values: &EffectiveValues,
) -> Result<(), ApiError> {
    let mut errors = ValidationErrors::new();

    let Some(kind) = values.kind else {
        errors.add("kind", "類型", "不可缺少");
        return Err(errors.into_api_error());
    };

    if let Some(amount) = values.amount_cents {
        if amount <= 0 {
            errors.add("amount_cents", "金額", "必須大於 0");
        }
    } else {
        errors.add("amount_cents", "金額", "不可為空白");
    }

    if values.occurred_at.is_none() {
        errors.add("occurred_at", "交易時間", "不可為空白");
    }

    let account_id = match &values.account_id {
        Some(value) if !value.is_empty() => value.clone(),
        _ => {
            errors.add("account", "帳戶", "不可缺少");
            return Err(errors.into_api_error());
        }
    };
    if !owned(db, user_id, "accounts", &account_id).await? {
        errors.add("account", "帳戶", "無效");
    }
    if let Some(category_id) = &values.category_id {
        if !owned(db, user_id, "categories", category_id).await? {
            errors.add("category", "分類", "無效");
        }
    }
    if let Some(merchant_id) = &values.merchant_id {
        if !owned(db, user_id, "merchants", merchant_id).await? {
            errors.add("merchant", "商家", "無效");
        }
    }
    if let Some(transfer_id) = &values.transfer_account_id {
        if !owned(db, user_id, "accounts", transfer_id).await? {
            errors.add("transfer_account", "轉帳帳戶", "無效");
        }
    }

    if kind == KIND_TRANSFER {
        if values.category_id.is_some() {
            errors.add("category", "分類", "無效");
        }
        match &values.transfer_account_id {
            None => errors.add("transfer_account", "轉帳帳戶", "不可為空白"),
            Some(transfer) if transfer == &account_id => {
                errors.add("transfer_account", "轉帳帳戶", "無效");
            }
            _ => {}
        }
    } else if values.transfer_account_id.is_some() {
        errors.add("transfer_account", "轉帳帳戶", "無效");
    }

    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }
    Ok(())
}

async fn owned(
    db: &DatabaseConnection,
    user_id: &str,
    table: &str,
    id: &str,
) -> Result<bool, ApiError> {
    let value = match table {
        "accounts" => accounts::Entity::find_by_id(id.to_string())
            .filter(accounts::Column::UserId.eq(user_id))
            .one(db)
            .await?
            .is_some(),
        "categories" => categories::Entity::find_by_id(id.to_string())
            .filter(categories::Column::UserId.eq(user_id))
            .one(db)
            .await?
            .is_some(),
        "merchants" => merchants::Entity::find_by_id(id.to_string())
            .filter(merchants::Column::UserId.eq(user_id))
            .one(db)
            .await?
            .is_some(),
        _ => false,
    };
    Ok(value)
}

fn parse_enum_field(
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

fn parse_i32_field(body: &Value, key: &str) -> Result<Option<i32>, ApiError> {
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

fn image_urls_error() -> ApiError {
    ApiError::validation("圖片網址格式無效", json!({ "image_urls": ["無效"] }))
}
