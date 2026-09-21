use loco_rs::testing::prelude::*;
use serial_test::serial;

use bookkeeping_backend::app::App;

use super::prepare_data::{
    at, auth_header, create_merchant, create_transaction, idempotency_header, json_body,
    register_and_login,
};

#[tokio::test]
#[serial]
async fn creates_and_lists_with_filter_and_pagination() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let created = request
            .post("/api/v1/transactions")
            .add_header(name.clone(), value.clone())
            .add_header(
                idempotency_header("create-key").0,
                idempotency_header("create-key").1,
            )
            .json(&serde_json::json!({
                "account_id": fixture.account_id,
                "kind": "expense",
                "amount_cents": 1000,
                "occurred_at": "2026-09-14T10:00:00+08:00"
            }))
            .await;
        assert_eq!(created.status_code(), 201);

        let listed = request
            .get("/api/v1/transactions?kind=expense&per_page=1")
            .add_header(name, value)
            .await;
        assert_eq!(listed.status_code(), 200);
        let body = json_body(&listed.text());
        assert_eq!(body["data"][0]["amount_cents"], 1000);
        assert_eq!(body["meta"]["total"], 1);
        assert_eq!(body["meta"]["per_page"], 1);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn search_query_matches_merchant_name() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let merchant = create_merchant(&ctx.db, &fixture.user_id, "Starbucks", 0, None).await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            1,
            1000,
            at(2026, 9, 14, 12, 0),
            None,
            Some(merchant.id.clone()),
            None,
            0,
        )
        .await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            1,
            2000,
            at(2026, 9, 14, 13, 0),
            None,
            None,
            None,
            0,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .get("/api/v1/transactions?q=starbucks")
            .add_header(name, value)
            .await;
        let body = json_body(&response.text());
        assert_eq!(body["meta"]["total"], 1);
        assert_eq!(body["data"][0]["merchant_id"], merchant.id);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn rejects_invalid_transfers() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let response = request
            .post("/api/v1/transactions")
            .add_header(name, value)
            .json(&serde_json::json!({
                "account_id": fixture.account_id,
                "kind": "transfer",
                "amount_cents": 1000,
                "occurred_at": "2026-09-14T10:00:00+08:00",
                "category_id": "bad"
            }))
            .await;
        assert_eq!(response.status_code(), 422);
        assert_eq!(
            json_body(&response.text())["error"]["code"],
            "validation_error"
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn repeated_create_is_idempotent() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let payload = serde_json::json!({
            "account_id": fixture.account_id,
            "kind": "expense",
            "amount_cents": 1000,
            "occurred_at": "2026-09-14T10:00:00+08:00"
        });

        let first = request
            .post("/api/v1/transactions")
            .add_header(name.clone(), value.clone())
            .add_header(idempotency_header("key-1").0, idempotency_header("key-1").1)
            .json(&payload)
            .await;
        assert_eq!(first.status_code(), 201);
        let first_id = json_body(&first.text())["data"]["id"].clone();

        let second = request
            .post("/api/v1/transactions")
            .add_header(name, value)
            .add_header(idempotency_header("key-1").0, idempotency_header("key-1").1)
            .json(&payload)
            .await;
        assert_eq!(second.status_code(), 201);
        assert_eq!(json_body(&second.text())["data"]["id"], first_id);
        assert_eq!(
            super::prepare_data::list_transactions(&ctx.db, &fixture.user_id, 0)
                .await
                .len(),
            1
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn rejects_idempotency_key_reuse_with_different_body() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let base = serde_json::json!({
            "account_id": fixture.account_id,
            "kind": "expense",
            "amount_cents": 1000,
            "occurred_at": "2026-09-14T10:00:00+08:00"
        });
        request
            .post("/api/v1/transactions")
            .add_header(name.clone(), value.clone())
            .add_header(idempotency_header("key-2").0, idempotency_header("key-2").1)
            .json(&base)
            .await;

        let mut changed = base.clone();
        changed["amount_cents"] = serde_json::json!(2000);
        let conflict = request
            .post("/api/v1/transactions")
            .add_header(name, value)
            .add_header(idempotency_header("key-2").0, idempotency_header("key-2").1)
            .json(&changed)
            .await;
        assert_eq!(conflict.status_code(), 422);
        assert_eq!(
            json_body(&conflict.text())["error"]["code"],
            "idempotency_conflict"
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn duplicates_a_transaction_with_a_new_id() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let original = create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            1,
            1000,
            at(2026, 9, 14, 12, 0),
            None,
            None,
            None,
            0,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .post(&format!("/api/v1/transactions/{}/duplicate", original.id))
            .add_header(name, value)
            .await;
        assert_eq!(response.status_code(), 201);
        assert_ne!(json_body(&response.text())["data"]["id"], original.id);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn does_not_expose_another_users_transaction() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let other = create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            1,
            1000,
            at(2026, 9, 14, 12, 0),
            None,
            None,
            None,
            0,
        )
        .await;
        // Reassign to another user to simulate ownership isolation.
        let (_token, bob_id) = super::prepare_data::register_named(&request, "bob").await;
        let _ = bob_id;
        // Bob's token cannot see Alice's transaction.
        let bob = request
            .post("/api/v1/auth/login")
            .json(&serde_json::json!({ "username": "bob", "password": "secret123" }))
            .await;
        let bob_token = json_body(&bob.text())["data"]["token"]
            .as_str()
            .unwrap()
            .to_string();
        let (name, value) = auth_header(&bob_token);
        let response = request
            .get(&format!("/api/v1/transactions/{}", other.id))
            .add_header(name, value)
            .await;
        assert_eq!(response.status_code(), 404);
    })
    .await;
}
