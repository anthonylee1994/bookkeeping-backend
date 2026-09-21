//! Shared helpers for reading loosely-typed JSON request bodies the way the
//! original Rails controllers did: absent and `null` are equivalent for most
//! fields, numeric fields also accept numeric strings, and enum fields are
//! matched case-sensitively against their string names.

use chrono::NaiveDateTime;
use serde_json::Value;

use super::error::ApiError;
use super::time;

/// Reads a string field, returning `None` when the key is absent or its value
/// is not a JSON string.
pub fn string_field(body: &Value, key: &str) -> Option<String> {
    body.get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

/// Whether the key is present at all, even when its value is `null`. Used to
/// tell "not provided" apart from "explicitly set to null".
pub fn touched(body: &Value, key: &str) -> bool {
    body.get(key).is_some()
}

/// Parses an enum field written as a string.
pub fn parse_enum_field(
    body: &Value,
    key: &str,
    parser: fn(&str) -> Option<i32>,
) -> Result<Option<i32>, ApiError> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => parser(value).map(Some).ok_or_else(ApiError::invalid_value),
        Some(_) => Err(ApiError::invalid_value()),
    }
}

/// Parses an `i32` field that may arrive as a JSON number or a numeric string.
pub fn parse_i32_field(body: &Value, key: &str) -> Result<Option<i32>, ApiError> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => number
            .as_i64()
            .and_then(|value| i32::try_from(value).ok())
            .map(Some)
            .ok_or_else(ApiError::invalid_value),
        Some(Value::String(value)) => value
            .trim()
            .parse::<i32>()
            .map(Some)
            .map_err(|_| ApiError::invalid_value()),
        Some(_) => Err(ApiError::invalid_value()),
    }
}

/// Parses a datetime string field. Absent/null stays `None`.
pub fn parse_datetime_field(body: &Value, key: &str) -> Result<Option<NaiveDateTime>, ApiError> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => time::parse_datetime(value)
            .map(Some)
            .ok_or_else(ApiError::invalid_value),
        Some(_) => Err(ApiError::invalid_value()),
    }
}
