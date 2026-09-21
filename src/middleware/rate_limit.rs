use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::{
    extract::{Request, State},
    http::Method,
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::api::{auth, error::ApiError};
use crate::app::AppContext;
use loco_rs::environment::Environment;

const WINDOW: Duration = Duration::from_secs(60);

#[derive(Clone, Copy)]
enum KeyKind {
    Ip,
    User,
}

struct Rule {
    name: &'static str,
    limit: usize,
    key: KeyKind,
}

fn rule_for(method: &Method, path: &str) -> Option<Rule> {
    let post = method == Method::POST;
    let patch = method == Method::PATCH || method == Method::PUT;

    if post && path == "/api/v1/auth/login" {
        return Some(Rule {
            name: "auth/login",
            limit: 5,
            key: KeyKind::Ip,
        });
    }
    if patch && path == "/api/v1/me/password" {
        return Some(Rule {
            name: "auth/password",
            limit: 5,
            key: KeyKind::User,
        });
    }
    if post && (path == "/api/v1/ai/parse" || path == "/api/v1/ai/confirm") {
        return Some(Rule {
            name: "ai",
            limit: 10,
            key: KeyKind::User,
        });
    }
    if post && path == "/api/v1/receipts/upload" {
        return Some(Rule {
            name: "upload",
            limit: 20,
            key: KeyKind::User,
        });
    }
    None
}

fn buckets() -> &'static Mutex<HashMap<String, Vec<Instant>>> {
    static BUCKETS: OnceLock<Mutex<HashMap<String, Vec<Instant>>>> = OnceLock::new();
    BUCKETS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn client_ip(request: &Request) -> String {
    if let Some(value) = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
    {
        if let Some(first) = value.split(',').next() {
            let first = first.trim();
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }
    request
        .headers()
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| "unknown".to_string())
}

fn discriminator(request: &Request, kind: KeyKind) -> String {
    match kind {
        KeyKind::Ip => client_ip(request),
        KeyKind::User => {
            let token = request
                .headers()
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| auth::bearer_token(Some(value)));
            token
                .and_then(|token| auth::decode_token_unsafe(&token))
                .unwrap_or_else(|| client_ip(request))
        }
    }
}

fn exceeded(key: &str, limit: usize) -> bool {
    let now = Instant::now();
    let mut guard = buckets().lock().expect("rate limit lock");
    let entries = guard.entry(key.to_string()).or_default();
    entries.retain(|at| now.duration_since(*at) < WINDOW);
    if entries.len() >= limit {
        return true;
    }
    entries.push(now);
    false
}

pub async fn handler(State(ctx): State<AppContext>, request: Request, next: Next) -> Response {
    if matches!(ctx.environment, Environment::Test) {
        return next.run(request).await;
    }

    if let Some(rule) = rule_for(request.method(), request.uri().path()) {
        let key = format!("{}:{}", rule.name, discriminator(&request, rule.key));
        if exceeded(&key, rule.limit) {
            return ApiError::rate_limited().into_response();
        }
    }

    next.run(request).await
}
