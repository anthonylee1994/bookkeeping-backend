use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use loco_rs::controller::Routes;
use serde_json::{json, Value};

use crate::api::{auth, error::ApiError, ApiResult};
use crate::app::AppContext;
use crate::models::users as users_model;
use crate::views;

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/v1/auth")
        .add("/register", axum::routing::post(register))
        .add("/login", axum::routing::post(login))
}

async fn register(State(ctx): State<AppContext>, Json(body): Json<Value>) -> ApiResult<Response> {
    let username = body.get("username").and_then(Value::as_str).unwrap_or("");
    let password = body.get("password").and_then(Value::as_str).unwrap_or("");

    let mut errors = crate::api::validation::ValidationErrors::new();
    let normalized = users_model::normalize_username(username);
    if normalized.is_empty() {
        errors.add("username", "使用者名稱", "不可為空白");
    } else if normalized.chars().count() > 64 {
        errors.add("username", "使用者名稱", "最多可輸入 64 個字元");
    }
    if password.is_empty() {
        errors.add("password", "密碼", "不可為空白");
    } else if password.chars().count() < 8 {
        errors.add("password", "密碼", "至少需要 8 個字元");
    }
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    if users_model::find_by_username(&ctx.db, &normalized)
        .await
        .map_err(ApiError::from)?
        .is_some()
    {
        return Err(username_taken());
    }

    let user = match users_model::create_user(&ctx.db, &normalized, password).await {
        Ok(user) => user,
        Err(err) => {
            if is_unique_violation(&err) {
                return Err(username_taken());
            }
            return Err(ApiError::from(err));
        }
    };

    let token = auth::encode_token(&user.id).map_err(|_| ApiError::internal())?;
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "data": {
                "token": token,
                "user": views::user_payload(&user),
            }
        })),
    )
        .into_response())
}

async fn login(State(ctx): State<AppContext>, Json(body): Json<Value>) -> ApiResult<Response> {
    let username = body.get("username").and_then(Value::as_str).unwrap_or("");
    let password = body.get("password").and_then(Value::as_str).unwrap_or("");

    let user = users_model::find_by_username(&ctx.db, username)
        .await
        .map_err(ApiError::from)?;
    let Some(user) = user.filter(|user| users_model::verify_password(user, password)) else {
        return Err(ApiError::invalid_credentials());
    };

    let token = auth::encode_token(&user.id).map_err(|_| ApiError::internal())?;
    Ok(Json(json!({
        "data": {
            "token": token,
            "user": views::user_payload(&user),
        }
    }))
    .into_response())
}

fn username_taken() -> ApiError {
    ApiError::validation("使用者名稱已被使用", json!({ "username": ["已被使用"] }))
}

fn is_unique_violation(err: &sea_orm::DbErr) -> bool {
    let message = err.to_string().to_ascii_lowercase();
    message.contains("unique") || message.contains("constraint")
}
