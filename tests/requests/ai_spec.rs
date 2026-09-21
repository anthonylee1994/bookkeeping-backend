use loco_rs::testing::prelude::*;
use serial_test::serial;
use sha2::{Digest, Sha256};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use bookkeeping_backend::app::App;

use super::prepare_data::{create_import_log, find_log, jpeg_bytes, json_body, register_and_login};

fn configure(server: &MockServer) {
    std::env::set_var("DEEPSEEK_BASE_URL", server.uri());
    std::env::set_var("DEEPSEEK_API_KEY", "test-key");
    std::env::set_var("DEEPSEEK_MODEL", "deepseek-flash");
    std::env::set_var("LIHKG_ALLOWED_HOSTS", "127.0.0.1");
    std::env::set_var("LIHKG_UPLOAD_URL", format!("{}/upload", server.uri()));
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn deepseek_body(parsed: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "choices": [{ "message": { "content": parsed.to_string() } }],
        "usage": { "prompt_tokens": 10, "completion_tokens": 8 }
    })
}

fn multipart_body(filename: &str, content_type: &str, bytes: &[u8]) -> Vec<u8> {
    let boundary = "----bookkeeping-test-boundary";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {content_type}\r\n\r\n").as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

#[tokio::test]
#[serial]
async fn upload_sends_lihkg_origin_and_returns_digest() {
    request::<App, _, _>(|request, ctx| async move {
        let server = MockServer::start().await;
        configure(&server);
        Mock::given(method("POST"))
            .and(path("/upload"))
            .and(header("origin", "https://lihkg.com"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "url": "https://img.eservice-hk.net/a.jpg"
            })))
            .mount(&server)
            .await;

        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = super::prepare_data::auth_header(&fixture.token);
        let jpeg = jpeg_bytes();
        let body = multipart_body("receipt.jpg", "image/jpeg", &jpeg);
        let response = request
            .post("/api/v1/receipts/upload")
            .add_header(name, value)
            .content_type("multipart/form-data; boundary=----bookkeeping-test-boundary")
            .bytes(body.into())
            .await;
        assert_eq!(response.status_code(), 201);
        let response_body = json_body(&response.text());
        assert!(response_body["data"]["url"]
            .as_str()
            .unwrap()
            .ends_with("a.jpg"));
        assert_eq!(response_body["data"]["sha256"].as_str().unwrap().len(), 64);
        assert_eq!(response_body["data"]["sha256"], sha256_hex(&jpeg));

        let requests = server.received_requests().await.unwrap();
        let upload = requests
            .iter()
            .find(|request| request.url.path() == "/upload")
            .expect("upload request");
        assert_eq!(
            upload.headers.get("origin").unwrap().to_str().unwrap(),
            "https://lihkg.com"
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn upload_rejects_non_image_file() {
    request::<App, _, _>(|request, ctx| async move {
        let server = MockServer::start().await;
        configure(&server);
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = super::prepare_data::auth_header(&fixture.token);
        let body = multipart_body("receipt.exe", "application/octet-stream", b"MZxxxx");
        let response = request
            .post("/api/v1/receipts/upload")
            .add_header(name, value)
            .content_type("multipart/form-data; boundary=----bookkeeping-test-boundary")
            .bytes(body.into())
            .await;
        assert_eq!(response.status_code(), 422);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn parse_caches_and_rejects_non_whitelisted_hosts() {
    request::<App, _, _>(|request, ctx| async move {
        let server = MockServer::start().await;
        configure(&server);
        let jpeg = jpeg_bytes();
        Mock::given(method("GET"))
            .and(path("/receipt.jpg"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(jpeg.clone(), "image/jpeg"))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(deepseek_body(
                &serde_json::json!({
                    "amount_cents": 1234,
                    "kind": "expense",
                    "occurred_at": "2026-09-14T10:00:00+08:00",
                    "confidence": 0.9
                }),
            )))
            .mount(&server)
            .await;

        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = super::prepare_data::auth_header(&fixture.token);
        let image_url = format!("{}/receipt.jpg", server.uri());

        for _ in 0..2 {
            let response = request
                .post("/api/v1/ai/parse")
                .add_header(name.clone(), value.clone())
                .json(&serde_json::json!({ "image_url": image_url }))
                .await;
            assert_eq!(response.status_code(), 200);
        }

        let deepseek_calls = server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .filter(|request| request.url.path() == "/chat/completions")
            .count();
        assert_eq!(deepseek_calls, 1, "second parse should hit the cache");

        let ssrf = request
            .post("/api/v1/ai/parse")
            .add_header(name, value)
            .json(&serde_json::json!({ "image_url": "http://169.254.169.254/private" }))
            .await;
        assert_eq!(ssrf.status_code(), 400);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn parse_ignores_a_stale_cache_entry() {
    request::<App, _, _>(|request, ctx| async move {
        let server = MockServer::start().await;
        configure(&server);
        let jpeg = jpeg_bytes();
        Mock::given(method("GET"))
            .and(path("/stale.jpg"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(jpeg.clone(), "image/jpeg"))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(deepseek_body(
                &serde_json::json!({
                    "amount_cents": 4500,
                    "kind": "expense",
                    "occurred_at": "2026-02-21T15:45:00",
                    "category_hint": "飲食",
                    "confidence": 0.9
                }),
            )))
            .mount(&server)
            .await;

        let fixture = register_and_login(&request, &ctx).await;
        let stale = create_import_log(
            &ctx.db,
            &fixture.user_id,
            &sha256_hex(&jpeg),
            serde_json::json!({ "amount_cents": 1, "kind": "expense", "category_hint": null }),
        )
        .await;

        let (name, value) = super::prepare_data::auth_header(&fixture.token);
        let response = request
            .post("/api/v1/ai/parse")
            .add_header(name, value)
            .json(&serde_json::json!({ "image_url": format!("{}/stale.jpg", server.uri()) }))
            .await;
        assert_eq!(response.status_code(), 200);
        let body = json_body(&response.text());
        assert_ne!(body["data"]["id"], stale.id);
        assert_eq!(body["data"]["parsed"]["amount_cents"], 4500);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn parse_handles_multibyte_and_prefix_markers_and_hint_normalization() {
    request::<App, _, _>(|request, ctx| async move {
        let server = MockServer::start().await;
        configure(&server);
        let jpeg = jpeg_bytes();
        for name in [
            "/cn.jpg",
            "/prefix.jpg",
            "/case.jpg",
            "/nomatch.jpg",
            "/kind.jpg",
        ] {
            Mock::given(method("GET"))
                .and(path(name))
                .respond_with(ResponseTemplate::new(200).set_body_raw(jpeg.clone(), "image/jpeg"))
                .mount(&server)
                .await;
        }
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(deepseek_body(
                &serde_json::json!({
                    "amount_cents": 1234,
                    "kind": "expense",
                    "occurred_at": "2026-09-14T10:00:00+08:00",
                    "merchant_name": "茶餐廳",
                    "note": "午餐",
                    "category_hint": "飲食",
                    "confidence": 0.9
                }),
            )))
            .mount(&server)
            .await;

        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = super::prepare_data::auth_header(&fixture.token);
        let response = request
            .post("/api/v1/ai/parse")
            .add_header(name, value)
            .json(&serde_json::json!({ "image_url": format!("{}/cn.jpg", server.uri()) }))
            .await;
        assert_eq!(response.status_code(), 200);
        assert_eq!(
            json_body(&response.text())["data"]["parsed"]["merchant_name"],
            "茶餐廳"
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn parse_matches_category_hint_against_user_categories() {
    request::<App, _, _>(|request, ctx| async move {
        let server = MockServer::start().await;
        configure(&server);
        let jpeg = jpeg_bytes();
        Mock::given(method("GET"))
            .and(path("/cat.jpg"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(jpeg.clone(), "image/jpeg"))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(deepseek_body(
                &serde_json::json!({
                    "amount_cents": 1234,
                    "kind": "expense",
                    "occurred_at": "2026-09-14T10:00:00+08:00",
                    "category_hint": "飲食",
                    "confidence": 0.9
                }),
            )))
            .mount(&server)
            .await;

        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = super::prepare_data::auth_header(&fixture.token);
        let response = request
            .post("/api/v1/ai/parse")
            .add_header(name, value)
            .json(&serde_json::json!({ "image_url": format!("{}/cat.jpg", server.uri()) }))
            .await;
        let body = json_body(&response.text());
        assert_eq!(body["data"]["parsed"]["category_hint"], "飲食");
        assert_eq!(
            body["data"]["suggested_category_id"],
            fixture.expense_category_id
        );

        // The prompt must include the user's expense categories.
        let requests = server.received_requests().await.unwrap();
        let deepseek = requests
            .iter()
            .find(|request| request.url.path() == "/chat/completions")
            .unwrap();
        let request_body: serde_json::Value = serde_json::from_slice(&deepseek.body).unwrap();
        let prompt = request_body["messages"][0]["content"][0]["text"]
            .as_str()
            .unwrap();
        assert!(prompt.contains("EXPENSE categories: [\"飲食\""));
    })
    .await;
}

#[tokio::test]
#[serial]
async fn parse_forces_unmatched_or_wrong_kind_hints_to_null() {
    request::<App, _, _>(|request, ctx| async move {
        let server = MockServer::start().await;
        configure(&server);
        let jpeg = jpeg_bytes();
        for name in ["/nomatch.jpg", "/kind.jpg", "/case.jpg"] {
            Mock::given(method("GET"))
                .and(path(name))
                .respond_with(ResponseTemplate::new(200).set_body_raw(jpeg.clone(), "image/jpeg"))
                .mount(&server)
                .await;
        }
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(|request: &wiremock::Request| {
                let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
                let prompt = body["messages"][0]["content"][0]["text"].as_str().unwrap();
                if prompt.contains("Groceries") {
                    ResponseTemplate::new(200).set_body_json(deepseek_body(&serde_json::json!({
                        "amount_cents": 1234,
                        "kind": "expense",
                        "occurred_at": "2026-09-14T10:00:00+08:00",
                        "category_hint": "groceries",
                        "confidence": 0.9
                    })))
                } else {
                    ResponseTemplate::new(200).set_body_json(deepseek_body(&serde_json::json!({
                        "amount_cents": 1234,
                        "kind": "expense",
                        "occurred_at": "2026-09-14T10:00:00+08:00",
                        "category_hint": "餐飲",
                        "confidence": 0.9
                    })))
                }
            })
            .mount(&server)
            .await;

        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = super::prepare_data::auth_header(&fixture.token);

        let unmatched = request
            .post("/api/v1/ai/parse")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({ "image_url": format!("{}/nomatch.jpg", server.uri()) }))
            .await;
        let body = json_body(&unmatched.text());
        assert_eq!(
            body["data"]["parsed"]["category_hint"],
            serde_json::Value::Null
        );
        assert_eq!(
            body["data"]["suggested_category_id"],
            serde_json::Value::Null
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn confirm_creates_an_ai_transaction() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let log = create_import_log(
            &ctx.db,
            &fixture.user_id,
            &"a".repeat(64),
            serde_json::json!({
                "amount_cents": 500,
                "kind": "expense",
                "occurred_at": "2026-09-14T10:00:00+08:00"
            }),
        )
        .await;

        let (name, value) = super::prepare_data::auth_header(&fixture.token);
        let response = request
            .post("/api/v1/ai/confirm")
            .add_header(name, value)
            .json(&serde_json::json!({
                "ai_import_log_id": log.id,
                "account_id": fixture.account_id,
                "amount_cents": 500,
                "kind": "expense",
                "occurred_at": "2026-09-14T10:00:00+08:00"
            }))
            .await;
        assert_eq!(response.status_code(), 201);
        let body = json_body(&response.text());
        assert_eq!(body["data"]["source"], "ai");
        assert_eq!(
            body["data"]["image_urls"][0],
            "https://img.eservice-hk.net/a.jpg"
        );
        assert_eq!(
            find_log(&ctx.db, &log.id).await.transaction_id.unwrap(),
            body["data"]["id"].as_str().unwrap()
        );
    })
    .await;
}
