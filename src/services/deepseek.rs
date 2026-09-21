use std::time::Instant;

use serde_json::{json, Value};

pub const PROMPT_VERSION: &str = "v2";
pub const STATUS_PENDING: i32 = 0;
pub const STATUS_SUCCESS: i32 = 1;
pub const STATUS_FAILED: i32 = 2;
pub const STATUS_PARTIAL: i32 = 3;

#[derive(Debug, thiserror::Error)]
pub enum DeepSeekError {
    #[error("{0}")]
    Upstream(String),
    #[error("{0}")]
    New(String),
}

pub struct CategoryRef {
    pub kind: i32,
    pub name: String,
}

pub struct Outcome {
    pub parsed: Option<Value>,
    pub raw_response: Option<String>,
    pub error_message: Option<String>,
    pub tokens_in: Option<i32>,
    pub tokens_out: Option<i32>,
    pub latency_ms: i32,
    pub status: i32,
}

fn base_url() -> String {
    std::env::var("DEEPSEEK_BASE_URL").unwrap_or_else(|_| "https://api.deepseek.com".to_string())
}

fn api_key() -> Result<String, DeepSeekError> {
    std::env::var("DEEPSEEK_API_KEY")
        .map_err(|_| DeepSeekError::Upstream("missing DEEPSEEK_API_KEY".into()))
}

fn model() -> String {
    std::env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| "deepseek-flash".to_string())
}

pub async fn call(
    image_base64: &str,
    content_type: &str,
    categories: &[CategoryRef],
) -> Result<Outcome, DeepSeekError> {
    let started = Instant::now();
    let key = api_key()?;

    let body = json!({
        "model": model(),
        "messages": [{
            "role": "user",
            "content": [
                { "type": "text", "text": prompt(categories) },
                { "type": "image_url", "image_url": { "url": format!("data:{content_type};base64,{image_base64}") } }
            ]
        }],
        "response_format": { "type": "json_object" }
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|err| DeepSeekError::New(err.to_string()))?;

    let response = client
        .post(format!(
            "{}/chat/completions",
            base_url().trim_end_matches('/')
        ))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {key}"))
        .json(&body)
        .send()
        .await
        .map_err(|err| DeepSeekError::Upstream(err.to_string()))?;

    if !response.status().is_success() {
        return Err(DeepSeekError::Upstream(format!(
            "DeepSeek returned {}",
            response.status()
        )));
    }

    let raw_text = response
        .text()
        .await
        .map_err(|err| DeepSeekError::Upstream(err.to_string()))?;
    let raw: Value = serde_json::from_str(&raw_text)
        .map_err(|err| DeepSeekError::Upstream(format!("invalid DeepSeek JSON: {err}")))?;

    let latency_ms = elapsed_ms(started);
    let tokens_in = raw
        .pointer("/usage/prompt_tokens")
        .and_then(Value::as_i64)
        .map(|v| v as i32);
    let tokens_out = raw
        .pointer("/usage/completion_tokens")
        .and_then(Value::as_i64)
        .map(|v| v as i32);

    let content = raw
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let mut parsed = extract_json_object(&content);
    if let Some(Value::Object(map)) = parsed.as_mut() {
        if map.get("type").and_then(Value::as_str) == Some("json_object") {
            map.remove("type");
        }
    }

    let Some(parsed) = parsed else {
        return Ok(Outcome {
            parsed: None,
            raw_response: Some(raw_text),
            error_message: Some("DeepSeek response did not contain a JSON object".to_string()),
            tokens_in,
            tokens_out,
            latency_ms,
            status: STATUS_PARTIAL,
        });
    };

    match validate(&parsed) {
        Ok(()) => Ok(Outcome {
            parsed: Some(parsed),
            raw_response: Some(raw_text),
            error_message: None,
            tokens_in,
            tokens_out,
            latency_ms,
            status: STATUS_SUCCESS,
        }),
        Err(message) => Ok(Outcome {
            parsed: Some(parsed),
            raw_response: Some(raw_text),
            error_message: Some(message),
            tokens_in,
            tokens_out,
            latency_ms,
            status: STATUS_PARTIAL,
        }),
    }
}

fn elapsed_ms(started: Instant) -> i32 {
    started.elapsed().as_millis().min(i32::MAX as u128) as i32
}

fn prompt(categories: &[CategoryRef]) -> String {
    let header =
        "You extract a single transaction from a receipt image and reply with JSON only.\n\
The JSON must have exactly these keys:\n\
- amount_cents: integer in cents (> 0)\n\
- kind: \"income\" or \"expense\"\n\
- occurred_at: ISO8601 date-time string\n\
- merchant_name: string or null\n\
- category_hint: string or null\n\
- note: string or null\n\
- confidence: number between 0 and 1\n\n";

    if categories.is_empty() {
        return format!(
            "{header}There are no user-defined categories. Always set category_hint to null."
        );
    }

    format!(
        "{header}Category rules (follow strictly):\n\
- Decide kind first, then set category_hint to one of the exact strings from that kind's list.\n\
- Copy the chosen name character-for-character. Do NOT translate it, shorten it, add \"(expense)\"/\"(income)\", or invent a new name.\n\
- If kind is \"expense\" only use the EXPENSE list; if kind is \"income\" only use the INCOME list.\n\
- If no category fits, set category_hint to null. Returning null is always allowed and preferred over guessing.\n\n\
EXPENSE categories: {}\n\
INCOME categories: {}\n",
        names_for(categories, 1),
        names_for(categories, 0),
    )
}

fn names_for(categories: &[CategoryRef], kind: i32) -> String {
    let names: Vec<&str> = categories
        .iter()
        .filter(|category| category.kind == kind)
        .map(|category| category.name.as_str())
        .collect();
    if names.is_empty() {
        "[]".to_string()
    } else {
        serde_json::to_string(&names).unwrap_or_else(|_| "[]".to_string())
    }
}

fn validate(parsed: &Value) -> Result<(), String> {
    let object = parsed
        .as_object()
        .ok_or_else(|| "parsed response is not an object".to_string())?;

    let amount = object
        .get("amount_cents")
        .and_then(Value::as_i64)
        .ok_or_else(|| "amount_cents must be an integer".to_string())?;
    if amount < 1 {
        return Err("amount_cents must be >= 1".to_string());
    }

    match object.get("kind").and_then(Value::as_str) {
        Some("income" | "expense") => {}
        _ => return Err("kind must be income or expense".to_string()),
    }

    if object.get("occurred_at").and_then(Value::as_str).is_none() {
        return Err("occurred_at must be a string".to_string());
    }

    for field in ["merchant_name", "category_hint", "note"] {
        if let Some(value) = object.get(field) {
            if !value.is_null() && !value.is_string() {
                return Err(format!("{field} must be a string or null"));
            }
        }
    }

    if let Some(value) = object.get("confidence") {
        if !value.is_null() {
            let number = value
                .as_f64()
                .ok_or_else(|| "confidence must be a number".to_string())?;
            if !(0.0..=1.0).contains(&number) {
                return Err("confidence must be between 0 and 1".to_string());
            }
        }
    }

    Ok(())
}

fn extract_json_object(content: &str) -> Option<Value> {
    let candidates = extract_json_objects(content);
    candidates
        .iter()
        .rev()
        .find(|object| {
            object
                .as_object()
                .map(|map| map.contains_key("amount_cents"))
                .unwrap_or(false)
        })
        .cloned()
        .or_else(|| candidates.last().cloned())
}

fn extract_json_objects(text: &str) -> Vec<Value> {
    let mut objects = Vec::new();
    let mut depth = 0usize;
    let mut start: Option<usize> = None;
    let mut in_string = false;
    let mut escaped = false;
    let chars: Vec<char> = text.chars().collect();

    for (index, ch) in chars.iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if *ch == '\\' {
                escaped = true;
            } else if *ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => {
                if depth > 0 {
                    in_string = true;
                }
            }
            '{' => {
                if depth == 0 {
                    start = Some(index);
                }
                depth += 1;
            }
            '}' => {
                if depth == 0 {
                    continue;
                }
                depth -= 1;
                if depth == 0 {
                    if let Some(begin) = start {
                        let slice: String = chars[begin..=index].iter().collect();
                        if let Ok(value) = serde_json::from_str::<Value>(&slice) {
                            objects.push(value);
                        }
                    }
                    start = None;
                }
            }
            _ => {}
        }
    }

    objects
}

/// Re-exposes the schema keys for documentation/tests.
pub fn schema() -> Value {
    json!({
        "type": "object",
        "required": ["amount_cents", "kind", "occurred_at"],
        "properties": {
            "amount_cents": { "type": "integer", "minimum": 1 },
            "kind": { "enum": ["income", "expense"] },
            "occurred_at": { "type": "string" },
            "merchant_name": { "type": ["string", "null"] },
            "category_hint": { "type": ["string", "null"] },
            "note": { "type": ["string", "null"] },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        }
    })
}
