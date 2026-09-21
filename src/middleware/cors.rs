use axum::http::{HeaderName, HeaderValue, Method};
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

/// Builds the CORS layer from `CORS_ORIGINS` (comma-separated). An empty list
/// means no origin is allowed.
pub fn layer() -> CorsLayer {
    let configured = std::env::var("CORS_ORIGINS").unwrap_or_default();
    let origins: Vec<HeaderValue> = configured
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter_map(|value| HeaderValue::from_str(value).ok())
        .collect();

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
            Method::HEAD,
        ])
        .allow_headers(Any)
        .expose_headers([
            HeaderName::from_static("authorization"),
            HeaderName::from_static("x-request-id"),
        ])
}
