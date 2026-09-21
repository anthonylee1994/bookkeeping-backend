use axum::{
    extract::Request,
    http::{header::HeaderName, HeaderValue},
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

tokio::task_local! {
    static REQUEST_ID: String;
}

pub const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");

pub fn current() -> Option<String> {
    REQUEST_ID.try_with(|id| id.clone()).ok()
}

pub async fn middleware(request: Request, next: Next) -> Response {
    let id = request
        .headers()
        .get(&REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let id_for_response = id.clone();
    let mut response = REQUEST_ID.scope(id, next.run(request)).await;

    if let Ok(value) = HeaderValue::from_str(&id_for_response) {
        response.headers_mut().insert(REQUEST_ID_HEADER, value);
    }
    response
}

#[derive(Debug, Clone)]
pub struct RequestId(pub String);

impl RequestId {
    pub fn value(&self) -> &str {
        &self.0
    }
}
