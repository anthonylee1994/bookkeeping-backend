use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use loco_rs::testing::prelude::*;
use sea_orm::EntityTrait;
use serial_test::serial;

use bookkeeping_backend::app::App;
use bookkeeping_backend::models::_entities::users;

use super::prepare_data::{auth_header, json_body, register_and_login};

#[tokio::test]
#[serial]
async fn register_returns_jwt_and_uuid_without_email() {
    request::<App, _, _>(|request, _ctx| async move {
        let response = request
            .post("/api/v1/auth/register")
            .json(&serde_json::json!({ "username": "Alice", "password": "secret123" }))
            .await;
        assert_eq!(response.status_code(), 201);
        let body = json_body(&response.text());
        let user_id = body["data"]["user"]["id"].as_str().unwrap();
        assert_eq!(user_id.len(), 36);
        assert!(user_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
        assert_eq!(body["data"]["user"]["username"], "alice");
        assert!(body["data"]["token"]
            .as_str()
            .is_some_and(|t| !t.is_empty()));
        assert!(body["data"]["user"].get("email").is_none());
    })
    .await;
}

#[tokio::test]
#[serial]
async fn register_ignores_email_field() {
    request::<App, _, _>(|request, _ctx| async move {
        let response = request
            .post("/api/v1/auth/register")
            .json(&serde_json::json!({
                "username": "bob",
                "password": "secret123",
                "email": "bob@example.com"
            }))
            .await;
        assert_eq!(response.status_code(), 201);
        assert!(json_body(&response.text())["data"]["user"]
            .get("email")
            .is_none());
    })
    .await;
}

#[tokio::test]
#[serial]
async fn register_rejects_duplicate_username_case_insensitively() {
    request::<App, _, _>(|request, ctx| async move {
        register_and_login(&request, &ctx).await;
        let response = request
            .post("/api/v1/auth/register")
            .json(&serde_json::json!({ "username": "ALICE", "password": "secret123" }))
            .await;
        assert_eq!(response.status_code(), 422);
        let body = json_body(&response.text());
        assert_eq!(body["error"]["code"], "validation_error");
        assert_eq!(body["error"]["message"], "使用者名稱已被使用");
    })
    .await;
}

#[tokio::test]
#[serial]
async fn register_rejects_short_password() {
    request::<App, _, _>(|request, _ctx| async move {
        let response = request
            .post("/api/v1/auth/register")
            .json(&serde_json::json!({ "username": "alice", "password": "short" }))
            .await;
        assert_eq!(response.status_code(), 422);
        let body = json_body(&response.text());
        assert_eq!(body["error"]["code"], "validation_error");
        assert_eq!(body["error"]["message"], "密碼至少需要 8 個字元");
    })
    .await;
}

#[tokio::test]
#[serial]
async fn login_returns_token_for_correct_password_case_insensitive_username() {
    request::<App, _, _>(|request, ctx| async move {
        register_and_login(&request, &ctx).await;
        let response = request
            .post("/api/v1/auth/login")
            .json(&serde_json::json!({ "username": "ALICE", "password": "secret123" }))
            .await;
        assert_eq!(response.status_code(), 200);
        let body = json_body(&response.text());
        assert_eq!(body["data"]["user"]["username"], "alice");
        assert_eq!(body["data"]["user"]["id"].as_str().unwrap().len(), 36);
        assert!(!body["data"]["token"].as_str().unwrap().is_empty());
    })
    .await;
}

#[tokio::test]
#[serial]
async fn login_rejects_wrong_password_and_unknown_username() {
    request::<App, _, _>(|request, ctx| async move {
        register_and_login(&request, &ctx).await;

        let wrong = request
            .post("/api/v1/auth/login")
            .json(&serde_json::json!({ "username": "alice", "password": "wrong-password" }))
            .await;
        assert_eq!(wrong.status_code(), 401);
        let body = json_body(&wrong.text());
        assert_eq!(body["error"]["code"], "invalid_credentials");
        assert_eq!(body["error"]["message"], "使用者名稱或密碼不正確");
        assert!(body["error"]["request_id"]
            .as_str()
            .is_some_and(|id| !id.is_empty()));

        let unknown = request
            .post("/api/v1/auth/login")
            .json(&serde_json::json!({ "username": "nobody", "password": "secret123" }))
            .await;
        assert_eq!(unknown.status_code(), 401);
        assert_eq!(
            json_body(&unknown.text())["error"]["code"],
            "invalid_credentials"
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn session_endpoints_are_absent() {
    request::<App, _, _>(|request, _ctx| async move {
        assert_eq!(
            request.delete("/api/v1/auth/logout").await.status_code(),
            404
        );
        assert_eq!(request.get("/api/v1/sessions").await.status_code(), 404);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn me_returns_current_user() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let response = request.get("/api/v1/me").add_header(name, value).await;
        assert_eq!(response.status_code(), 200);
        let body = json_body(&response.text());
        assert_eq!(body["data"]["id"], fixture.user_id);
        assert_eq!(body["data"]["username"], "alice");
        assert_eq!(body["data"]["timezone"], "Asia/Hong_Kong");
        assert_eq!(body["data"]["currency"], "HKD");
    })
    .await;
}

#[tokio::test]
#[serial]
async fn me_rejects_missing_malformed_and_forged_tokens() {
    request::<App, _, _>(|request, ctx| async move {
        assert_eq!(request.get("/api/v1/me").await.status_code(), 401);

        let malformed = request
            .get("/api/v1/me")
            .add_header(
                axum::http::HeaderName::from_static("authorization"),
                axum::http::HeaderValue::from_static("Bearer not-a-jwt"),
            )
            .await;
        assert_eq!(malformed.status_code(), 401);
        assert_eq!(
            json_body(&malformed.text())["error"]["code"],
            "unauthorized"
        );

        let fixture = register_and_login(&request, &ctx).await;
        let forged = encode(
            &Header::new(Algorithm::HS256),
            &serde_json::json!({ "user_id": fixture.user_id, "iat": 1_700_000_000i64 }),
            &EncodingKey::from_secret(b"forged-secret"),
        )
        .unwrap();
        let response = request
            .get("/api/v1/me")
            .add_header(
                axum::http::HeaderName::from_static("authorization"),
                axum::http::HeaderValue::from_str(&format!("Bearer {forged}")).unwrap(),
            )
            .await;
        assert_eq!(response.status_code(), 401);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn me_rejects_token_when_user_no_longer_exists() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        users::Entity::delete_by_id(fixture.user_id.clone())
            .exec(&ctx.db)
            .await
            .unwrap();
        let (name, value) = auth_header(&fixture.token);
        let response = request.get("/api/v1/me").add_header(name, value).await;
        assert_eq!(response.status_code(), 401);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn the_same_token_works_for_multiple_requests() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let first = request
            .get("/api/v1/me")
            .add_header(name.clone(), value.clone())
            .await;
        assert_eq!(first.status_code(), 200);
        let id = json_body(&first.text())["data"]["id"].clone();
        let second = request.get("/api/v1/me").add_header(name, value).await;
        assert_eq!(json_body(&second.text())["data"]["id"], id);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn update_password_success_and_login_afterwards() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let response = request
            .patch("/api/v1/me/password")
            .add_header(name, value)
            .json(&serde_json::json!({
                "password_challenge": "secret123",
                "password": "newsecret123",
                "password_confirmation": "newsecret123"
            }))
            .await;
        assert_eq!(response.status_code(), 200);
        assert_eq!(json_body(&response.text())["data"]["username"], "alice");

        let login = request
            .post("/api/v1/auth/login")
            .json(&serde_json::json!({ "username": "alice", "password": "newsecret123" }))
            .await;
        assert_eq!(login.status_code(), 200);
        assert!(!json_body(&login.text())["data"]["token"]
            .as_str()
            .unwrap()
            .is_empty());

        let old = request
            .post("/api/v1/auth/login")
            .json(&serde_json::json!({ "username": "alice", "password": "secret123" }))
            .await;
        assert_eq!(old.status_code(), 401);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn update_password_rejects_bad_input() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);

        let wrong = request
            .patch("/api/v1/me/password")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({ "password_challenge": "wrong-password", "password": "newsecret123" }))
            .await;
        assert_eq!(wrong.status_code(), 422);
        let body = json_body(&wrong.text());
        assert_eq!(body["error"]["code"], "invalid_current_password");
        assert_eq!(body["error"]["message"], "目前密碼不正確");

        let missing_challenge = request
            .patch("/api/v1/me/password")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({ "password": "newsecret123" }))
            .await;
        assert_eq!(missing_challenge.status_code(), 422);
        assert_eq!(json_body(&missing_challenge.text())["error"]["code"], "invalid_current_password");

        let short = request
            .patch("/api/v1/me/password")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({ "password_challenge": "secret123", "password": "short" }))
            .await;
        assert_eq!(short.status_code(), 422);
        let body = json_body(&short.text());
        assert_eq!(body["error"]["code"], "validation_error");
        assert_eq!(body["error"]["message"], "密碼至少需要 8 個字元");

        let mismatch = request
            .patch("/api/v1/me/password")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({
                "password_challenge": "secret123",
                "password": "newsecret123",
                "password_confirmation": "different123"
            }))
            .await;
        assert_eq!(mismatch.status_code(), 422);
        assert_eq!(json_body(&mismatch.text())["error"]["code"], "validation_error");

        let missing_new = request
            .patch("/api/v1/me/password")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({ "password_challenge": "secret123" }))
            .await;
        assert_eq!(missing_new.status_code(), 422);
        assert_eq!(json_body(&missing_new.text())["error"]["code"], "validation_error");

        // Still the original password after all failed attempts.
        let login = request
            .post("/api/v1/auth/login")
            .json(&serde_json::json!({ "username": "alice", "password": "secret123" }))
            .await;
        assert_eq!(login.status_code(), 200);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn update_password_requires_a_token() {
    request::<App, _, _>(|request, ctx| async move {
        let _ = register_and_login(&request, &ctx).await;
        let response = request
            .patch("/api/v1/me/password")
            .json(&serde_json::json!({ "password_challenge": "secret123", "password": "newsecret123" }))
            .await;
        assert_eq!(response.status_code(), 401);
        assert_eq!(json_body(&response.text())["error"]["code"], "unauthorized");
    })
    .await;
}
