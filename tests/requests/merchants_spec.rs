use loco_rs::testing::prelude::*;
use serial_test::serial;

use bookkeeping_backend::app::App;

use super::prepare_data::{
    auth_header, create_category, create_merchant, json_body, register_and_login, register_named,
};

#[tokio::test]
#[serial]
async fn search_returns_at_most_ten_ordered_by_usage() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        for index in 0..11 {
            create_merchant(
                &ctx.db,
                &fixture.user_id,
                &format!("Coffee {index}"),
                index,
                None,
            )
            .await;
        }
        create_merchant(&ctx.db, &fixture.user_id, "Tea", 100, None).await;
        let (_token, bob_id) = register_named(&request, "bob").await;
        create_merchant(&ctx.db, &bob_id, "Coffee outsider", 200, None).await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .get("/api/v1/merchants?q=coffee")
            .add_header(name, value)
            .await;
        assert_eq!(response.status_code(), 200);
        let body = json_body(&response.text());
        let rows = body["data"].as_array().unwrap();
        assert_eq!(rows.len(), 10);
        assert_eq!(rows[0]["name"], "Coffee 10");
        assert!(!rows.iter().any(|row| row["name"] == "Coffee outsider"));
        assert!(!rows.iter().any(|row| row["name"] == "Coffee 0"));
    })
    .await;
}

#[tokio::test]
#[serial]
async fn no_query_returns_all_owned_merchants() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        for index in 0..12 {
            create_merchant(
                &ctx.db,
                &fixture.user_id,
                &format!("Merchant {index}"),
                index,
                None,
            )
            .await;
        }
        let (_token, bob_id) = register_named(&request, "bob").await;
        create_merchant(&ctx.db, &bob_id, "Outsider", 0, None).await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .get("/api/v1/merchants")
            .add_header(name, value)
            .await;
        let body = json_body(&response.text());
        let rows = body["data"].as_array().unwrap();
        assert_eq!(rows.len(), 12);
        assert!(!rows.iter().any(|row| row["name"] == "Outsider"));
    })
    .await;
}

#[tokio::test]
#[serial]
async fn deleting_a_category_nullifies_a_merchant_default_category() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);

        let created = request
            .post("/api/v1/merchants")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({
                "name": "Cafe",
                "default_category_id": fixture.expense_category_id
            }))
            .await;
        assert_eq!(created.status_code(), 201);
        let merchant_id = json_body(&created.text())["data"]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let deleted = request
            .delete(&format!(
                "/api/v1/categories/{}",
                fixture.expense_category_id
            ))
            .add_header(name.clone(), value.clone())
            .await;
        assert_eq!(deleted.status_code(), 204);

        let list = request
            .get("/api/v1/merchants?q=Cafe")
            .add_header(name, value)
            .await;
        let body = json_body(&list.text());
        let merchant = body["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"] == merchant_id)
            .expect("merchant present");
        assert_eq!(merchant["default_category_id"], serde_json::Value::Null);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn rejects_another_users_category_as_default() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (_token, bob_id) = register_named(&request, "bob").await;
        let bob_category = create_category(&ctx.db, &bob_id, "Bob 分類", 1).await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .post("/api/v1/merchants")
            .add_header(name, value)
            .json(&serde_json::json!({
                "name": "Cafe",
                "default_category_id": bob_category.id
            }))
            .await;
        assert_eq!(response.status_code(), 422);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn updates_a_merchants_name_and_default_category() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let merchant = create_merchant(&ctx.db, &fixture.user_id, "Cafe", 0, None).await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .patch(&format!("/api/v1/merchants/{}", merchant.id))
            .add_header(name, value)
            .json(&serde_json::json!({
                "name": "Coffee Shop",
                "default_category_id": fixture.expense_category_id
            }))
            .await;
        assert_eq!(response.status_code(), 200);
        let body = json_body(&response.text());
        assert_eq!(body["data"]["name"], "Coffee Shop");
        assert_eq!(
            body["data"]["default_category_id"],
            fixture.expense_category_id
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn rejects_updating_to_another_users_category() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let merchant = create_merchant(&ctx.db, &fixture.user_id, "Cafe", 0, None).await;
        let (_token, bob_id) = register_named(&request, "bob").await;
        let bob_category = create_category(&ctx.db, &bob_id, "Bob 分類", 1).await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .patch(&format!("/api/v1/merchants/{}", merchant.id))
            .add_header(name, value)
            .json(&serde_json::json!({ "default_category_id": bob_category.id }))
            .await;
        assert_eq!(response.status_code(), 422);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn does_not_update_another_users_merchant() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (_token, bob_id) = register_named(&request, "bob").await;
        let bob_merchant = create_merchant(&ctx.db, &bob_id, "Cafe", 0, None).await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .patch(&format!("/api/v1/merchants/{}", bob_merchant.id))
            .add_header(name, value)
            .json(&serde_json::json!({ "name": "Hacked" }))
            .await;
        assert_eq!(response.status_code(), 404);
    })
    .await;
}
