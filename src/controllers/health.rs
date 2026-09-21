use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use sea_orm::ConnectionTrait;
use serde_json::{json, Value};

use crate::app::AppContext;
use loco_rs::controller::Routes;

pub fn routes() -> Routes {
    Routes::new()
        .add("/up", axum::routing::get(up))
        .add("/health", axum::routing::get(health))
        .add("/health/db", axum::routing::get(db_health))
        .add("/health/deepseek", axum::routing::get(deepseek_health))
        .add("/health/lihkg", axum::routing::get(lihkg_health))
}

async fn up() -> Response {
    StatusCode::OK.into_response()
}

async fn health(State(ctx): State<AppContext>) -> Response {
    let checks = json!({
        "db": check_db(&ctx).await,
        "deepseek": check_deepseek().await,
        "lihkg": check_lihkg().await,
    });
    render(checks)
}

async fn db_health(State(ctx): State<AppContext>) -> Response {
    render(json!({ "db": check_db(&ctx).await }))
}

async fn deepseek_health() -> Response {
    render(json!({ "deepseek": check_deepseek().await }))
}

async fn lihkg_health() -> Response {
    render(json!({ "lihkg": check_lihkg().await }))
}

fn render(checks: Value) -> Response {
    let healthy = checks
        .as_object()
        .map(|map| {
            map.values()
                .all(|check| check.get("status").and_then(Value::as_str) == Some("ok"))
        })
        .unwrap_or(false);
    let body = json!({
        "status": if healthy { "ok" } else { "error" },
        "checks": checks,
    });
    let status = if healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(body)).into_response()
}

async fn check_db(ctx: &AppContext) -> Value {
    match ctx
        .db
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "PRAGMA journal_mode".to_string(),
        ))
        .await
    {
        Ok(Some(row)) => {
            let mode: String = row.try_get("", "journal_mode").unwrap_or_default();
            let wal = mode.eq_ignore_ascii_case("wal");
            json!({ "status": if wal { "ok" } else { "error" }, "wal": wal })
        }
        Ok(None) => json!({ "status": "error", "wal": false }),
        Err(err) => {
            tracing::warn!(error = %err, "health db check failed");
            json!({ "status": "error", "wal": false })
        }
    }
}

async fn check_deepseek() -> Value {
    let base =
        std::env::var("DEEPSEEK_BASE_URL").unwrap_or_else(|_| "https://api.deepseek.com".into());
    let Ok(key) = std::env::var("DEEPSEEK_API_KEY") else {
        return json!({ "status": "error" });
    };
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(_) => return json!({ "status": "error" }),
    };
    match client
        .get(format!("{}/models", base.trim_end_matches('/')))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {key}"))
        .send()
        .await
    {
        Ok(response) => json!({
            "status": if response.status().is_success() { "ok" } else { "error" },
            "code": response.status().as_u16(),
        }),
        Err(err) => {
            tracing::warn!(error = %err, "health deepseek check failed");
            json!({ "status": "error" })
        }
    }
}

async fn check_lihkg() -> Value {
    let url = std::env::var("LIHKG_HEALTHCHECK_URL")
        .or_else(|_| std::env::var("LIHKG_UPLOAD_URL"))
        .unwrap_or_else(|_| "https://img.eservice-hk.net/api.php?version=2".into());
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(_) => return json!({ "status": "error" }),
    };
    let mut request = client.get(&url);
    if url.contains("img.eservice-hk.net") {
        request = request.header(reqwest::header::ORIGIN, "https://lihkg.com");
    }
    match request.send().await {
        Ok(response) => json!({
            "status": if response.status().is_success() { "ok" } else { "error" },
            "code": response.status().as_u16(),
        }),
        Err(err) => {
            tracing::warn!(error = %err, "health lihkg check failed");
            json!({ "status": "error" })
        }
    }
}
