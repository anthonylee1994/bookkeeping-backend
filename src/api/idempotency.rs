use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::Duration;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::api::{time, util};
use crate::models::_entities::idempotency_keys;

/// Wraps a handler with `Idempotency-Key` semantics: a matching key within 24h
/// replays the stored response; the same key with a different request hash is
/// a 422 `idempotency_conflict`.
pub async fn wrap<F, Fut>(
    db: &DatabaseConnection,
    user_id: &str,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    raw_body: &[u8],
    run: F,
) -> Response
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = (StatusCode, Value)>,
{
    let Some(key) = headers
        .get("Idempotency-Key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
    else {
        let (status, body) = run().await;
        return (status, Json(body)).into_response();
    };

    let mut hasher = Sha256::new();
    hasher.update(method.as_bytes());
    hasher.update([0u8]);
    hasher.update(path.as_bytes());
    hasher.update([0u8]);
    hasher.update(raw_body);
    let request_hash = hex::encode(hasher.finalize());

    let existing = idempotency_keys::Entity::find()
        .filter(idempotency_keys::Column::UserId.eq(user_id))
        .filter(idempotency_keys::Column::Key.eq(&key))
        .one(db)
        .await
        .ok()
        .flatten();

    if let Some(existing) = &existing {
        let cutoff = time::now_local() - Duration::hours(24);
        if existing.created_at > cutoff {
            if existing.request_hash != request_hash {
                return crate::api::error::ApiError::idempotency_conflict().into_response();
            }
            let status = existing
                .response_status
                .and_then(|code| StatusCode::from_u16(code as u16).ok())
                .unwrap_or(StatusCode::OK);
            let body = existing
                .response_body
                .as_deref()
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .unwrap_or_else(|| Value::Object(Default::default()));
            return (status, Json(body)).into_response();
        }
    }

    let (status, body) = run().await;

    let record = idempotency_keys::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user_id.to_string()),
        key: Set(key.clone()),
        request_hash: Set(request_hash),
        response_status: Set(Some(status.as_u16() as i32)),
        response_body: Set(serde_json::to_string(&body).ok()),
        created_at: Set(time::now_local()),
        updated_at: Set(time::now_local()),
    };

    if existing.is_some() {
        if let Some(existing) = existing {
            let mut active: idempotency_keys::ActiveModel = existing.into();
            active.request_hash = record.request_hash;
            active.response_status = record.response_status;
            active.response_body = record.response_body;
            active.created_at = record.created_at;
            active.updated_at = record.updated_at;
            let _ = active.update(db).await;
        }
    } else if let Err(err) = record.insert(db).await {
        tracing::debug!(error = %err, "idempotency key insert failed");
    }

    (status, Json(body)).into_response()
}
