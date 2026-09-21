use uuid::Uuid;

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn env_bool(name: &str, default: bool) -> bool {
    match std::env::var(name) {
        Ok(value) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => default,
    }
}

pub fn env_i64(name: &str, default: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(default)
}

/// Mirrors `ActiveRecord::Base.sanitize_sql_like`: escape the LIKE wildcards
/// and the escape character itself using `\`.
pub fn sanitize_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub fn clamp_page(page: Option<&str>) -> i64 {
    page.and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(1)
        .max(1)
}

pub fn clamp_per_page(per_page: Option<&str>) -> i64 {
    per_page
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(25)
        .clamp(1, 100)
}
