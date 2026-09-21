use loco_rs::testing::prelude::*;
use serial_test::serial;

use bookkeeping_backend::app::App;

use super::prepare_data::{
    at, auth_header, create_account, create_transaction, json_body, register_and_login,
    register_named,
};

#[tokio::test]
#[serial]
async fn lists_the_default_cash_account() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let response = request
            .get("/api/v1/accounts")
            .add_header(name, value)
            .await;
        assert_eq!(response.status_code(), 200);
        let body = json_body(&response.text());
        let rows = body["data"].as_array().unwrap();
        assert!(rows.iter().any(|row| row["name"] == "現金"));
        assert!(rows.iter().any(|row| row["kind"] == "cash"));
        assert!(rows.iter().any(|row| row["color"] == "#ecf0f1"));
    })
    .await;
}

#[tokio::test]
#[serial]
async fn creates_updates_and_deletes_an_unused_account() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);

        let created = request
            .post("/api/v1/accounts")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({ "name": "銀行", "kind": "bank", "initial_balance_cents": 500 }))
            .await;
        assert_eq!(created.status_code(), 201);
        let account_id = json_body(&created.text())["data"]["id"].as_str().unwrap().to_string();

        let updated = request
            .patch(&format!("/api/v1/accounts/{account_id}"))
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({ "name": "儲蓄戶口" }))
            .await;
        assert_eq!(updated.status_code(), 200);
        assert_eq!(json_body(&updated.text())["data"]["name"], "儲蓄戶口");

        let deleted = request
            .delete(&format!("/api/v1/accounts/{account_id}"))
            .add_header(name, value)
            .await;
        assert_eq!(deleted.status_code(), 204);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn does_not_expose_another_users_account() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (_bob_token, bob_id) = register_named(&request, "bob").await;
        let bob_account = create_account(&ctx.db, &bob_id, "Bob 現金", 0).await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .patch(&format!("/api/v1/accounts/{}", bob_account.id))
            .add_header(name, value)
            .json(&serde_json::json!({ "name": "stolen" }))
            .await;
        assert_eq!(response.status_code(), 404);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn returns_account_in_use_when_dependent_records_exist() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            1,
            1000,
            at(2026, 9, 14, 12, 0),
            Some(fixture.expense_category_id.clone()),
            None,
            None,
            0,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .delete(&format!("/api/v1/accounts/{}", fixture.account_id))
            .add_header(name, value)
            .await;
        assert_eq!(response.status_code(), 422);
        assert_eq!(
            json_body(&response.text())["error"]["code"],
            "account_in_use"
        );
    })
    .await;
}
