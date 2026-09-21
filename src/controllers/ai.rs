use axum::{
    body::Bytes,
    extract::State,
    http::{header::CONTENT_TYPE, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::Duration;
use loco_rs::controller::Routes;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::api::{error::ApiError, idempotency, time, util, ApiResult, AuthUser};
use crate::app::AppContext;
use crate::models::_entities::{ai_import_logs, categories};
use crate::services::deepseek::{self, CategoryRef};
use crate::views;

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/v1")
        .add("/ai/parse", axum::routing::post(parse))
        .add("/ai/confirm", axum::routing::post(confirm))
}

struct CategoryInfo {
    id: String,
    kind: i32,
    name: String,
}

async fn parse(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let Some(url) = body.get("image_url").and_then(Value::as_str) else {
        return Err(ApiError::parameter_missing("image_url"));
    };

    if !allowed_host(url) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "validation_error",
            "image host is not allowed",
        ));
    }

    let (bytes, content_type) = fetch_image(url).await?;
    let sha = sha256_hex(&bytes);

    let category_rows = categories::Entity::find()
        .filter(categories::Column::UserId.eq(user.id()))
        .order_by_asc(categories::Column::Kind)
        .order_by_asc(categories::Column::CreatedAt)
        .all(&ctx.db)
        .await?;
    let category_infos: Vec<CategoryInfo> = category_rows
        .into_iter()
        .map(|row| CategoryInfo {
            id: row.id,
            kind: row.kind,
            name: row.name,
        })
        .collect();
    let signature = parse_signature(&category_infos);

    let cutoff = time::now_local() - Duration::hours(ai_cache_hours());
    let cached = ai_import_logs::Entity::find()
        .filter(ai_import_logs::Column::UserId.eq(user.id()))
        .filter(ai_import_logs::Column::ImageSha256.eq(&sha))
        .filter(ai_import_logs::Column::ParseSignature.eq(&signature))
        .filter(ai_import_logs::Column::Status.eq(deepseek::STATUS_SUCCESS))
        .filter(ai_import_logs::Column::CreatedAt.gt(cutoff))
        .order_by_desc(ai_import_logs::Column::CreatedAt)
        .limit(1)
        .one(&ctx.db)
        .await?;

    if let Some(cached) = cached {
        let payload = cached_payload(&cached, &category_infos);
        return Ok(Json(json!({ "data": payload })).into_response());
    }

    let image_base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    let refs: Vec<CategoryRef> = category_infos
        .iter()
        .map(|category| CategoryRef {
            kind: category.kind,
            name: category.name.clone(),
        })
        .collect();

    let outcome = deepseek::call(&image_base64, &content_type, &refs)
        .await
        .map_err(|err| ApiError::upstream_error(err.to_string()))?;

    let parsed = outcome
        .parsed
        .as_ref()
        .map(|value| normalize_category_hint(value, &category_infos));

    let now = time::now_local();
    let log =
        ai_import_logs::ActiveModel {
            id: Set(util::new_id()),
            user_id: Set(user.id().to_string()),
            image_urls: Set(json!([url])),
            image_sha256: Set(sha),
            parse_signature: Set(Some(signature)),
            provider: Set("deepseek".to_string()),
            model: Set(
                std::env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| "deepseek-flash".to_string())
            ),
            tokens_in: Set(outcome.tokens_in),
            tokens_out: Set(outcome.tokens_out),
            latency_ms: Set(Some(outcome.latency_ms)),
            status: Set(outcome.status),
            raw_response: Set(outcome.raw_response),
            parsed_json: Set(parsed.clone()),
            error_message: Set(outcome.error_message),
            transaction_id: Set(None),
            idempotency_key: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&ctx.db)
        .await?;

    let payload = cached_payload(&log, &category_infos);
    Ok(Json(json!({ "data": payload })).into_response())
}

async fn confirm(
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
        "/api/v1/ai/confirm",
        &raw,
        || async {
            match do_confirm(&ctx, &user, &raw).await {
                Ok((status, value)) => (status, value),
                Err(err) => (err.status, err.body_value()),
            }
        },
    )
    .await;
    Ok(response)
}

async fn do_confirm(
    ctx: &AppContext,
    user: &AuthUser,
    raw: &[u8],
) -> Result<(StatusCode, Value), ApiError> {
    let body: Value = serde_json::from_slice(raw).map_err(|_| ApiError::invalid_value())?;
    let log_id = body
        .get("ai_import_log_id")
        .and_then(Value::as_str)
        .or_else(|| body.get("import_log_id").and_then(Value::as_str))
        .ok_or_else(|| ApiError::parameter_missing("import_log_id"))?;

    let log = ai_import_logs::Entity::find_by_id(log_id.to_string())
        .filter(ai_import_logs::Column::UserId.eq(user.id()))
        .one(&ctx.db)
        .await?
        .ok_or_else(ApiError::not_found)?;

    let mut transaction_body = body.clone();
    if let Some(object) = transaction_body.as_object_mut() {
        object.remove("ai_import_log_id");
        object.remove("import_log_id");
        let has_urls = object
            .get("image_urls")
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty());
        if !has_urls {
            object.insert("image_urls".to_string(), log.image_urls.clone());
        }
        object.insert("source".to_string(), json!("ai"));
    }

    let transaction =
        super::transactions::create_validated(&ctx.db, user.id(), &transaction_body, Some(2))
            .await?;

    let mut log_active: ai_import_logs::ActiveModel = log.into();
    log_active.transaction_id = Set(Some(transaction.id.clone()));
    log_active.updated_at = Set(time::now_local());
    log_active.update(&ctx.db).await?;

    Ok((
        StatusCode::CREATED,
        json!({ "data": views::transaction_payload_with_net(&transaction, true) }),
    ))
}

fn allowed_host(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }
    let allowed: Vec<String> = std::env::var("LIHKG_ALLOWED_HOSTS")
        .unwrap_or_else(|_| "img.eservice-hk.net".to_string())
        .split(',')
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    let Some(host) = parsed.host_str() else {
        return false;
    };
    allowed.iter().any(|candidate| candidate == host)
}

async fn fetch_image(url: &str) -> Result<(Vec<u8>, String), ApiError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|err| ApiError::upstream_error(err.to_string()))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| ApiError::upstream_error(err.to_string()))?;
    if !response.status().is_success() {
        return Err(ApiError::upstream_error(format!(
            "image fetch failed ({})",
            response.status()
        )));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let bytes = response
        .bytes()
        .await
        .map_err(|err| ApiError::upstream_error(err.to_string()))?;
    Ok((bytes.to_vec(), content_type))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn ai_cache_hours() -> i64 {
    util::env_i64("AI_CACHE_HOURS", 24)
}

fn parse_signature(category_infos: &[CategoryInfo]) -> String {
    let mut keys: Vec<String> = category_infos
        .iter()
        .map(|category| format!("{}:{}", kind_key(category.kind), category.name))
        .collect();
    keys.sort();
    let mut hasher = Sha256::new();
    hasher.update(deepseek::PROMPT_VERSION.as_bytes());
    hasher.update([0u8]);
    hasher.update(keys.join("\u{0}").as_bytes());
    hex::encode(hasher.finalize())
}

fn kind_key(kind: i32) -> &'static str {
    if kind == 0 {
        "income"
    } else {
        "expense"
    }
}

fn cached_payload(log: &ai_import_logs::Model, category_infos: &[CategoryInfo]) -> Value {
    let normalized = log
        .parsed_json
        .as_ref()
        .map(|value| normalize_category_hint(value, category_infos))
        .filter(|value| !value.is_null())
        .unwrap_or_else(|| json!({}));
    let suggested = suggested_category_id(&normalized, category_infos);
    views::ai_payload(views::AiPayloadInput {
        log,
        parsed: normalized,
        suggested_category_id: suggested,
    })
}

fn normalize_category_hint(parsed: &Value, category_infos: &[CategoryInfo]) -> Value {
    if parsed.is_null() || parsed.as_object().is_none_or(|object| object.is_empty()) {
        return parsed.clone();
    }
    let mut normalized = parsed.clone();
    if let Some(object) = normalized.as_object_mut() {
        let matched = match_category(parsed, category_infos);
        object.insert(
            "category_hint".to_string(),
            matched.map_or(Value::Null, |category| json!(category.name)),
        );
    }
    normalized
}

fn suggested_category_id(parsed: &Value, category_infos: &[CategoryInfo]) -> Option<String> {
    match_category(parsed, category_infos).map(|category| category.id.clone())
}

fn match_category<'a>(
    parsed: &Value,
    category_infos: &'a [CategoryInfo],
) -> Option<&'a CategoryInfo> {
    let hint = parsed
        .get("category_hint")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if hint.is_empty() {
        return None;
    }
    let kind = parsed.get("kind").and_then(Value::as_str).unwrap_or("");
    let kind_value = if kind == "income" { 0 } else { 1 };
    category_infos.iter().find(|category| {
        category.kind == kind_value && category.name.to_lowercase() == hint.to_lowercase()
    })
}
