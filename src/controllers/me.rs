use axum::{
    extract::State,
    response::{IntoResponse, Response},
    Json,
};
use loco_rs::controller::Routes;
use serde_json::{json, Value};

use crate::api::{error::ApiError, validation::ValidationErrors, ApiResult, AuthUser};
use crate::app::AppContext;
use crate::models::users as users_model;
use crate::views;

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/v1")
        .add("/me", axum::routing::get(show))
        .add("/me/password", axum::routing::patch(update_password))
}

async fn show(user: AuthUser) -> ApiResult<Response> {
    Ok(Json(json!({ "data": views::user_payload(&user.0) })).into_response())
}

async fn update_password(
    State(ctx): State<AppContext>,
    user: AuthUser,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let challenge = body
        .get("password_challenge")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !users_model::verify_password(&user.0, challenge) {
        return Err(ApiError::invalid_current_password());
    }

    let Some(password) = body.get("password").and_then(Value::as_str) else {
        return Err(ApiError::parameter_missing("password"));
    };
    let confirmation = body.get("password_confirmation").and_then(Value::as_str);

    let mut errors = ValidationErrors::new();
    if password.chars().count() < 8 {
        errors.add("password", "密碼", "至少需要 8 個字元");
    }
    if let Some(confirmation) = confirmation {
        if confirmation != password {
            errors.add("password_confirmation", "確認密碼", "與密碼不一致");
        }
    }
    if !errors.is_empty() {
        return Err(errors.into_api_error());
    }

    let updated = users_model::update_password(&ctx.db, &user.0, password).await?;
    Ok(Json(json!({ "data": views::user_payload(&updated) })).into_response())
}
