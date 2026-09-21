use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::error::ApiError;

/// Collects Rails-style validation errors: a per-field `details` map plus the
/// first full message (used as the top-level `message`).
#[derive(Default)]
pub struct ValidationErrors {
    details: BTreeMap<String, Vec<String>>,
    first: Option<String>,
}

impl ValidationErrors {
    pub fn new() -> Self {
        Self::default()
    }

    /// `human` is the localized attribute name, `message` the localized
    /// message; the reported full message is the concatenation (Rails
    /// `errors.format` = `%{attribute}%{message}`).
    pub fn add(&mut self, field: &str, human: &str, message: &str) {
        let full = format!("{human}{message}");
        if self.first.is_none() {
            self.first = Some(full);
        }
        self.details
            .entry(field.to_string())
            .or_default()
            .push(message.to_string());
    }

    pub fn is_empty(&self) -> bool {
        self.details.is_empty()
    }

    pub fn into_api_error(self) -> ApiError {
        if self.is_empty() {
            return ApiError::invalid_value();
        }
        let details: Value = json!(self.details);
        ApiError::validation(self.first.unwrap_or_default(), details)
    }

    pub fn to_api_error(&self) -> ApiError {
        self.clone().into_api_error()
    }
}

impl Clone for ValidationErrors {
    fn clone(&self) -> Self {
        Self {
            details: self.details.clone(),
            first: self.first.clone(),
        }
    }
}
