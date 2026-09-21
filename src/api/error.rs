use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use super::request_id;

/// Unified API error matching the documented envelope:
/// `{ "error": { "code", "message", "details"?, "request_id" } }`
#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: String,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

impl ApiError {
    pub fn new(status: StatusCode, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", "請先登入")
    }

    pub fn invalid_credentials() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "invalid_credentials",
            "使用者名稱或密碼不正確",
        )
    }

    pub fn invalid_current_password() -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_current_password",
            "目前密碼不正確",
        )
    }

    pub fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", "找不到指定的資料")
    }

    pub fn parameter_missing(parameter: &str) -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation_error",
            format!("缺少必要參數或參數不可為空：{parameter}"),
        )
    }

    pub fn invalid_value() -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation_error",
            "參數值無效",
        )
    }

    pub fn validation(message: impl Into<String>, details: serde_json::Value) -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation_error",
            message,
        )
        .with_details(details)
    }

    pub fn account_in_use() -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "account_in_use",
            "帳戶已有交易或週期性規則，無法刪除",
        )
    }

    pub fn idempotency_conflict() -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "idempotency_conflict",
            "相同的 Idempotency-Key 已用於不同請求",
        )
    }

    pub fn already_materialized() -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "already_materialized",
            "該次週期交易已經建立",
        )
    }

    pub fn upstream_error(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_GATEWAY, "upstream_error", message)
    }

    pub fn rate_limited() -> Self {
        Self::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "請求過於頻繁，請稍後再試",
        )
    }

    pub fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_server_error",
            "Internal Server Error",
        )
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ApiError {}

impl From<sea_orm::DbErr> for ApiError {
    fn from(err: sea_orm::DbErr) -> Self {
        tracing::error!(error = %err, "database error");
        Self::internal()
    }
}

impl ApiError {
    pub fn body_value(&self) -> serde_json::Value {
        let mut body = json!({
            "code": self.code,
            "message": self.message,
        });
        if let Some(details) = &self.details {
            body["details"] = details.clone();
        }
        body["request_id"] = json!(request_id::current().unwrap_or_default());
        json!({ "error": body })
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = self.body_value();
        (self.status, Json(body)).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
