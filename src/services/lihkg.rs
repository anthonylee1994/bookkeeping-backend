use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;

pub const ALLOWED_TYPES: &[&str] = &["image/jpeg", "image/png", "image/gif", "image/webp"];

#[derive(Debug, thiserror::Error)]
pub enum LihkgError {
    #[error("{0}")]
    InvalidFile(String),
    #[error("LIHKG circuit is open")]
    CircuitOpen,
    #[error("{0}")]
    Upstream(String),
}

struct CircuitState {
    failures: u32,
    open_until: Option<Instant>,
}

static CIRCUIT: Mutex<Option<CircuitState>> = Mutex::new(None);

fn detect_content_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return Some("image/jpeg");
    }
    if bytes.len() >= 8 && bytes[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return Some("image/png");
    }
    if bytes.len() >= 6 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

fn max_bytes() -> usize {
    std::env::var("MAX_UPLOAD_BYTES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(10 * 1024 * 1024)
}

fn circuit_failures() -> u32 {
    std::env::var("LIHKG_CIRCUIT_FAILURES")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(5)
}

fn circuit_cooldown() -> Duration {
    let seconds = std::env::var("LIHKG_CIRCUIT_COOLDOWN")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(60);
    Duration::from_secs(seconds)
}

fn circuit_is_open() -> bool {
    let mut guard = CIRCUIT.lock().expect("circuit lock");
    let state = guard.get_or_insert(CircuitState {
        failures: 0,
        open_until: None,
    });
    if let Some(until) = state.open_until {
        if Instant::now() < until {
            return true;
        }
        state.open_until = None;
        state.failures = 0;
    }
    false
}

fn record_success() {
    let mut guard = CIRCUIT.lock().expect("circuit lock");
    if let Some(state) = guard.as_mut() {
        state.failures = 0;
        state.open_until = None;
    }
}

fn record_failure() {
    let mut guard = CIRCUIT.lock().expect("circuit lock");
    let state = guard.get_or_insert(CircuitState {
        failures: 0,
        open_until: None,
    });
    state.failures += 1;
    if state.failures >= circuit_failures() {
        state.open_until = Some(Instant::now() + circuit_cooldown());
    }
}

pub struct UploadFile {
    pub bytes: Vec<u8>,
    pub filename: String,
}

/// Uploads to the (unofficial) LIHKG image host. The outbound request MUST
/// carry `Origin: https://lihkg.com`; the host rejects anything else.
pub async fn upload(file: UploadFile) -> Result<String, LihkgError> {
    if file.bytes.is_empty() {
        return Err(LihkgError::InvalidFile("file is required".into()));
    }
    if file.bytes.len() > max_bytes() {
        return Err(LihkgError::InvalidFile("file is too large".into()));
    }
    let content_type = detect_content_type(&file.bytes)
        .ok_or_else(|| LihkgError::InvalidFile("unsupported file type".into()))?;
    if !ALLOWED_TYPES.contains(&content_type) {
        return Err(LihkgError::InvalidFile("unsupported file type".into()));
    }

    if circuit_is_open() {
        return Err(LihkgError::CircuitOpen);
    }

    let url = std::env::var("LIHKG_UPLOAD_URL")
        .unwrap_or_else(|_| "https://img.eservice-hk.net/api.php?version=2".to_string());

    let part = reqwest::multipart::Part::bytes(file.bytes)
        .file_name(file.filename)
        .mime_str(content_type)
        .map_err(|err| LihkgError::Upstream(err.to_string()))?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|err| LihkgError::Upstream(err.to_string()))?;

    let response = client
        .post(&url)
        .header(reqwest::header::ORIGIN, "https://lihkg.com")
        .multipart(form)
        .send()
        .await;

    match response {
        Ok(response) if response.status().is_success() => {
            let body: Value = response
                .json()
                .await
                .map_err(|err| LihkgError::Upstream(err.to_string()))?;
            let found = body
                .get("url")
                .and_then(Value::as_str)
                .or_else(|| {
                    body.get("data")
                        .and_then(|d| d.get("url"))
                        .and_then(Value::as_str)
                })
                .or_else(|| {
                    body.get("result")
                        .and_then(|r| r.get("url"))
                        .and_then(Value::as_str)
                })
                .map(ToString::to_string);
            match found {
                Some(url) => {
                    record_success();
                    Ok(url)
                }
                None => {
                    record_failure();
                    Err(LihkgError::Upstream(
                        "LIHKG response did not contain a URL".into(),
                    ))
                }
            }
        }
        Ok(response) => {
            record_failure();
            Err(LihkgError::Upstream(format!(
                "LIHKG upload failed ({})",
                response.status()
            )))
        }
        Err(err) => {
            record_failure();
            Err(LihkgError::Upstream(err.to_string()))
        }
    }
}
