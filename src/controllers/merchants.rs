use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use loco_rs::controller::Routes;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{
    error::ApiError, params, time, util, validation::ValidationErrors, ApiResult, AuthUser,
};
use crate::app::AppContext;
use crate::models::_entities::{categories, merchants, transactions};
use crate::views;

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/v1")
        .add("/merchants", axum::routing::get(index))
        .add("/merchants", axum::routing::post(create))
        .add("/merchants/{id}", axum::routing::patch(update))
        .add("/merchants/{id}", axum::routing::delete(destroy))
}

#[derive(Deserialize)]
struct IndexParams {
    q: Option<String>,
}

async fn find_scoped(
    db: &DatabaseConnection,
    user_id: &str,
    id: &str,
) -> Result<merchants::Model, ApiError> {
    merchants::Entity::find_by_id(id.to_string())
        .filter(merchants::Column::UserId.eq(user_id))
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
    let mut query = merchants::Entity::find().filter(merchants::Column::UserId.eq(user.id()));
    if let Some(q) = params.q.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
        query = query.filter(merchants::Column::Name.like(format!("%{}%", util::sanitize_like(q))));
    }
    let mut query = query
        .order_by_desc(merchants::Column::UsageCount)
        .order_by_asc(merchants::Column::Name);
    if params.q.is_some() {
        query = query.limit(10);
    }
    let rows = query.all(&ctx.db).await?;
    let data: Vec<Value> = rows.iter().map(views::merchant_payload).collect();
    Ok(Json(json!({ "data": data })).into_response())
}

async fn create(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let name = body.get("name").and_then(Value::as_str).unwrap_or("");
    let default_category_id = params::string_field(&body, "default_category_id");

    let mut errors = ValidationErrors::new();
    if name.trim().is_empty() {
        errors.add("name", "商家名稱", "不可為空白");
    } else if exists_name(&ctx.db, user.id(), name.trim(), None).await? {
        errors.add("name", "商家名稱", "已被使用");
    }
    if let Some(category_id) = &default_category_id {
        if !category_owned(&ctx.db, user.id(), category_id).await? {
            errors.add("default_category", "預設分類", "無效");
        }
    }
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    let now = time::now_local();
    let merchant = merchants::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user.id().to_string()),
        name: Set(name.trim().to_string()),
        default_category_id: Set(default_category_id),
        usage_count: Set(0),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&ctx.db)
    .await
    .map_err(map_db_error)?;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "data": views::merchant_payload(&merchant) })),
    )
        .into_response())
}

async fn update(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let merchant = find_scoped(&ctx.db, user.id(), &id).await?;
    let name = body.get("name").and_then(Value::as_str);

    let mut errors = ValidationErrors::new();
    if let Some(name) = name {
        if name.trim().is_empty() {
            errors.add("name", "商家名稱", "不可為空白");
        } else if exists_name(&ctx.db, user.id(), name.trim(), Some(&merchant.id)).await? {
            errors.add("name", "商家名稱", "已被使用");
        }
    }
    if params::touched(&body, "default_category_id") {
        if let Some(category_id) = params::string_field(&body, "default_category_id") {
            if !category_owned(&ctx.db, user.id(), &category_id).await? {
                errors.add("default_category", "預設分類", "無效");
            }
        }
    }
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    let mut active: merchants::ActiveModel = merchant.into();
    if let Some(name) = name {
        active.name = Set(name.trim().to_string());
    }
    if params::touched(&body, "default_category_id") {
        active.default_category_id = Set(params::string_field(&body, "default_category_id"));
    }
    active.updated_at = Set(time::now_local());
    let merchant = active.update(&ctx.db).await.map_err(map_db_error)?;

    Ok(Json(json!({ "data": views::merchant_payload(&merchant) })).into_response())
}

async fn destroy(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let merchant = find_scoped(&ctx.db, user.id(), &id).await?;

    transactions::Entity::update_many()
        .col_expr(
            transactions::Column::MerchantId,
            sea_orm::sea_query::Expr::value(Option::<String>::None),
        )
        .filter(transactions::Column::MerchantId.eq(&merchant.id))
        .exec(&ctx.db)
        .await?;

    merchants::Entity::delete_by_id(merchant.id)
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
    let mut query = merchants::Entity::find()
        .filter(merchants::Column::UserId.eq(user_id))
        .filter(merchants::Column::Name.eq(name));
    if let Some(except_id) = except_id {
        query = query.filter(merchants::Column::Id.ne(except_id));
    }
    Ok(query.one(db).await?.is_some())
}

async fn category_owned(
    db: &DatabaseConnection,
    user_id: &str,
    category_id: &str,
) -> Result<bool, ApiError> {
    Ok(categories::Entity::find_by_id(category_id.to_string())
        .filter(categories::Column::UserId.eq(user_id))
        .one(db)
        .await?
        .is_some())
}

fn map_db_error(err: sea_orm::DbErr) -> ApiError {
    let message = err.to_string().to_ascii_lowercase();
    if message.contains("unique") {
        ApiError::validation("商家名稱已被使用", json!({ "name": ["已被使用"] }))
    } else {
        ApiError::from(err)
    }
}
