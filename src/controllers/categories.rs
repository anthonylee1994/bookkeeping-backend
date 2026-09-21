use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
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
use crate::models::_entities::{categories, merchants, recurring_rules, transactions};
use crate::views;

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/v1")
        .add("/categories", axum::routing::get(index))
        .add("/categories", axum::routing::post(create))
        .add("/categories/{id}", axum::routing::patch(update))
        .add("/categories/{id}", axum::routing::delete(destroy))
}

#[derive(Deserialize)]
struct IndexParams {
    kind: Option<String>,
}

async fn find_scoped(
    db: &DatabaseConnection,
    user_id: &str,
    id: &str,
) -> Result<categories::Model, ApiError> {
    categories::Entity::find_by_id(id.to_string())
        .filter(categories::Column::UserId.eq(user_id))
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
    let kind = match params.kind.as_deref() {
        None | Some("") => None,
        Some(value) => match views::parse_category_kind(value) {
            Some(kind) => Some(kind),
            // Unknown enum values cast to NULL in Rails, which matches nothing.
            None => {
                return Ok(Json(json!({ "data": [] })).into_response());
            }
        },
    };

    let mut query = categories::Entity::find().filter(categories::Column::UserId.eq(user.id()));
    if let Some(kind) = kind {
        query = query.filter(categories::Column::Kind.eq(kind));
    }
    let rows = query
        .order_by_asc(categories::Column::Kind)
        .order_by_asc(categories::Column::CreatedAt)
        .all(&ctx.db)
        .await?;
    let data: Vec<Value> = rows.iter().map(views::category_payload).collect();
    Ok(Json(json!({ "data": data })).into_response())
}

async fn create(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let name = body.get("name").and_then(Value::as_str).unwrap_or("");
    let kind = params::parse_enum_field(&body, "kind", views::parse_category_kind)?;

    let mut errors = ValidationErrors::new();
    if name.trim().is_empty() {
        errors.add("name", "分類名稱", "不可為空白");
    }
    if let Some(kind) = kind {
        if !name.trim().is_empty()
            && exists_name(&ctx.db, user.id(), kind, name.trim(), None).await?
        {
            errors.add("name", "分類名稱", "已被使用");
        }
    } else {
        errors.add("kind", "分類類型", "不可為空白");
    }
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    let now = time::now_local();
    let category = categories::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user.id().to_string()),
        name: Set(name.trim().to_string()),
        kind: Set(kind.unwrap_or(0)),
        icon: Set(body
            .get("icon")
            .and_then(Value::as_str)
            .map(ToString::to_string)),
        color: Set(body
            .get("color")
            .and_then(Value::as_str)
            .map(ToString::to_string)),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&ctx.db)
    .await
    .map_err(map_db_error)?;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "data": views::category_payload(&category) })),
    )
        .into_response())
}

async fn update(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let category = find_scoped(&ctx.db, user.id(), &id).await?;
    let kind = params::parse_enum_field(&body, "kind", views::parse_category_kind)?;
    let name = body.get("name").and_then(Value::as_str);
    let effective_kind = kind.unwrap_or(category.kind);
    let effective_name = name.map(str::trim).unwrap_or(category.name.as_str());

    let mut errors = ValidationErrors::new();
    if let Some(name) = name {
        if name.trim().is_empty() {
            errors.add("name", "分類名稱", "不可為空白");
        }
    }
    if !effective_name.is_empty()
        && exists_name(
            &ctx.db,
            user.id(),
            effective_kind,
            effective_name,
            Some(&category.id),
        )
        .await?
    {
        errors.add("name", "分類名稱", "已被使用");
    }
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    let mut active: categories::ActiveModel = category.into();
    if let Some(name) = name {
        active.name = Set(name.trim().to_string());
    }
    if let Some(kind) = kind {
        active.kind = Set(kind);
    }
    if let Some(icon) = body.get("icon").and_then(Value::as_str) {
        active.icon = Set(Some(icon.to_string()));
    }
    if let Some(color) = body.get("color").and_then(Value::as_str) {
        active.color = Set(Some(color.to_string()));
    }
    active.updated_at = Set(time::now_local());
    let category = active.update(&ctx.db).await.map_err(map_db_error)?;

    Ok(Json(json!({ "data": views::category_payload(&category) })).into_response())
}

async fn destroy(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let category = find_scoped(&ctx.db, user.id(), &id).await?;

    transactions::Entity::update_many()
        .col_expr(
            transactions::Column::CategoryId,
            sea_orm::sea_query::Expr::value(Option::<String>::None),
        )
        .filter(transactions::Column::CategoryId.eq(&category.id))
        .exec(&ctx.db)
        .await?;
    merchants::Entity::update_many()
        .col_expr(
            merchants::Column::DefaultCategoryId,
            sea_orm::sea_query::Expr::value(Option::<String>::None),
        )
        .filter(merchants::Column::DefaultCategoryId.eq(&category.id))
        .exec(&ctx.db)
        .await?;
    recurring_rules::Entity::update_many()
        .col_expr(
            recurring_rules::Column::CategoryId,
            sea_orm::sea_query::Expr::value(Option::<String>::None),
        )
        .filter(recurring_rules::Column::CategoryId.eq(&category.id))
        .exec(&ctx.db)
        .await?;

    categories::Entity::delete_by_id(category.id)
        .exec(&ctx.db)
        .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn exists_name(
    db: &DatabaseConnection,
    user_id: &str,
    kind: i32,
    name: &str,
    except_id: Option<&str>,
) -> Result<bool, ApiError> {
    let mut query = categories::Entity::find()
        .filter(categories::Column::UserId.eq(user_id))
        .filter(categories::Column::Kind.eq(kind))
        .filter(categories::Column::Name.eq(name));
    if let Some(except_id) = except_id {
        query = query.filter(categories::Column::Id.ne(except_id));
    }
    Ok(query.one(db).await?.is_some())
}

fn map_db_error(err: sea_orm::DbErr) -> ApiError {
    let message = err.to_string().to_ascii_lowercase();
    if message.contains("unique") {
        ApiError::validation("分類名稱已被使用", json!({ "name": ["已被使用"] }))
    } else {
        ApiError::from(err)
    }
}
