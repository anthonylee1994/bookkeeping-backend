use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use loco_rs::controller::Routes;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use serde_json::{json, Value};

use crate::api::{
    error::ApiError, params, time, util, validation::ValidationErrors, ApiResult, AuthUser,
};
use crate::app::AppContext;
use crate::models::_entities::{accounts, recurring_rules, transactions};
use crate::views;

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/v1")
        .add("/accounts", axum::routing::get(index))
        .add("/accounts", axum::routing::post(create))
        .add("/accounts/{id}", axum::routing::patch(update))
        .add("/accounts/{id}", axum::routing::delete(destroy))
}

async fn find_scoped(
    db: &DatabaseConnection,
    user_id: &str,
    id: &str,
) -> Result<accounts::Model, ApiError> {
    accounts::Entity::find_by_id(id.to_string())
        .filter(accounts::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::not_found)
}

async fn index(user: AuthUser, State(ctx): State<AppContext>) -> ApiResult<Response> {
    let rows = accounts::Entity::find()
        .filter(accounts::Column::UserId.eq(user.id()))
        .order_by_asc(accounts::Column::CreatedAt)
        .all(&ctx.db)
        .await?;
    let data: Vec<Value> = rows.iter().map(views::account_payload).collect();
    Ok(Json(json!({ "data": data })).into_response())
}

async fn create(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let name = body.get("name").and_then(Value::as_str).unwrap_or("");
    let kind = params::parse_enum_field(&body, "kind", views::parse_account_kind)?;
    let initial_balance = params::parse_i32_field(&body, "initial_balance_cents")?;

    let mut errors = ValidationErrors::new();
    if name.trim().is_empty() {
        errors.add("name", "帳戶名稱", "不可為空白");
    } else if exists_name(&ctx.db, user.id(), name.trim(), None).await? {
        errors.add("name", "帳戶名稱", "已被使用");
    }
    if kind.is_none() {
        errors.add("kind", "帳戶類型", "不可為空白");
    }
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    let now = time::now_local();
    let account = accounts::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user.id().to_string()),
        name: Set(name.trim().to_string()),
        kind: Set(kind.unwrap_or(0)),
        icon: Set(params::string_field(&body, "icon")),
        color: Set(params::string_field(&body, "color")),
        initial_balance_cents: Set(initial_balance.unwrap_or(0)),
        currency: Set(params::string_field(&body, "currency").unwrap_or_else(|| "HKD".to_string())),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&ctx.db)
    .await
    .map_err(map_db_error)?;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "data": views::account_payload(&account) })),
    )
        .into_response())
}

async fn update(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let account = find_scoped(&ctx.db, user.id(), &id).await?;
    let kind = params::parse_enum_field(&body, "kind", views::parse_account_kind)?;
    let initial_balance = params::parse_i32_field(&body, "initial_balance_cents")?;
    let name = body.get("name").and_then(Value::as_str);

    let mut errors = ValidationErrors::new();
    if let Some(name) = name {
        if name.trim().is_empty() {
            errors.add("name", "帳戶名稱", "不可為空白");
        } else if exists_name(&ctx.db, user.id(), name.trim(), Some(&account.id)).await? {
            errors.add("name", "帳戶名稱", "已被使用");
        }
    }
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    let mut active: accounts::ActiveModel = account.into();
    if let Some(name) = name {
        active.name = Set(name.trim().to_string());
    }
    if let Some(kind) = kind {
        active.kind = Set(kind);
    }
    if let Some(balance) = initial_balance {
        active.initial_balance_cents = Set(balance);
    }
    if let Some(icon) = params::string_field(&body, "icon") {
        active.icon = Set(Some(icon));
    }
    if let Some(color) = params::string_field(&body, "color") {
        active.color = Set(Some(color));
    }
    if let Some(currency) = params::string_field(&body, "currency") {
        active.currency = Set(currency);
    }
    active.updated_at = Set(time::now_local());
    let account = active.update(&ctx.db).await.map_err(map_db_error)?;

    Ok(Json(json!({ "data": views::account_payload(&account) })).into_response())
}

async fn destroy(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let account = find_scoped(&ctx.db, user.id(), &id).await?;

    let used_as_account = transactions::Entity::find()
        .filter(transactions::Column::AccountId.eq(&account.id))
        .limit(1)
        .one(&ctx.db)
        .await?
        .is_some();
    let used_as_transfer = transactions::Entity::find()
        .filter(transactions::Column::TransferAccountId.eq(&account.id))
        .limit(1)
        .one(&ctx.db)
        .await?
        .is_some();
    let used_by_rule = recurring_rules::Entity::find()
        .filter(recurring_rules::Column::AccountId.eq(&account.id))
        .limit(1)
        .one(&ctx.db)
        .await?
        .is_some();

    if used_as_account || used_as_transfer || used_by_rule {
        return Err(ApiError::account_in_use());
    }

    accounts::Entity::delete_by_id(account.id)
        .exec(&ctx.db)
        .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn exists_name(
    db: &DatabaseConnection,
    user_id: &str,
    name: &str,
    except_id: Option<&str>,
) -> Result<bool, ApiError> {
    let mut query = accounts::Entity::find()
        .filter(accounts::Column::UserId.eq(user_id))
        .filter(accounts::Column::Name.eq(name));
    if let Some(except_id) = except_id {
        query = query.filter(accounts::Column::Id.ne(except_id));
    }
    Ok(query.one(db).await?.is_some())
}

fn map_db_error(err: sea_orm::DbErr) -> ApiError {
    let message = err.to_string().to_ascii_lowercase();
    if message.contains("unique") {
        ApiError::validation("帳戶名稱已被使用", json!({ "name": ["已被使用"] }))
    } else {
        ApiError::from(err)
    }
}
