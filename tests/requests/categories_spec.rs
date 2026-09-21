use loco_rs::testing::prelude::*;
use serial_test::serial;

use bookkeeping_backend::app::App;

use super::prepare_data::{auth_header, json_body, register_and_login, register_named};

fn names_of_kind(rows: &[serde_json::Value], kind: &str) -> Vec<String> {
    rows.iter()
        .filter(|row| row["kind"] == kind)
        .map(|row| row["name"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
#[serial]
async fn seeds_the_expected_default_categories() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let response = request
            .get("/api/v1/categories")
            .add_header(name, value)
            .await;
        assert_eq!(response.status_code(), 200);
        let body = json_body(&response.text());
        let rows = body["data"].as_array().unwrap();
        assert_eq!(rows.len(), 13);

        assert_eq!(
            names_of_kind(rows, "expense"),
            vec![
                "飲食",
                "交通",
                "娛樂",
                "購物",
                "醫療",
                "住屋",
                "水電",
                "其他支出"
            ]
        );
        assert_eq!(
            names_of_kind(rows, "income"),
            vec!["薪水", "獎金", "投資", "兼職", "其他收入"]
        );
        assert!(!rows.iter().any(|row| row["name"] == "收入"));

        let colors: Vec<&str> = rows
            .iter()
            .map(|row| row["color"].as_str().unwrap())
            .collect();
        assert!(colors.iter().all(|color| *color == "#ecf0f1"));

        let icons: std::collections::BTreeMap<&str, &str> = rows
            .iter()
            .map(|row| (row["name"].as_str().unwrap(), row["icon"].as_str().unwrap()))
            .collect();
        let expected: std::collections::BTreeMap<&str, &str> = std::collections::BTreeMap::from([
            ("飲食", "mdi:food"),
            ("交通", "mdi:bus"),
            ("娛樂", "mdi:music"),
            ("購物", "mdi:cart"),
            ("醫療", "mdi:medical-bag"),
            ("住屋", "mdi:home"),
            ("水電", "mdi:lightning-bolt"),
            ("其他支出", "mdi:credit-card"),
            ("薪水", "mdi:bank"),
            ("獎金", "mdi:gift"),
            ("投資", "mdi:piggy-bank"),
            ("兼職", "mdi:cash"),
            ("其他收入", "mdi:wallet"),
        ]);
        assert_eq!(icons, expected);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn filters_creates_updates_and_deletes_categories() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);

        let created = request
            .post("/api/v1/categories")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({ "name": "寵物", "kind": "expense" }))
            .await;
        assert_eq!(created.status_code(), 201);
        let category_id = json_body(&created.text())["data"]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let updated = request
            .patch(&format!("/api/v1/categories/{category_id}"))
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({ "name": "毛孩" }))
            .await;
        assert_eq!(updated.status_code(), 200);
        assert_eq!(json_body(&updated.text())["data"]["name"], "毛孩");

        let filtered = request
            .get("/api/v1/categories?kind=expense")
            .add_header(name.clone(), value.clone())
            .await;
        let body = json_body(&filtered.text());
        assert!(body["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["kind"] == "expense"));

        let deleted = request
            .delete(&format!("/api/v1/categories/{category_id}"))
            .add_header(name, value)
            .await;
        assert_eq!(deleted.status_code(), 204);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn does_not_expose_another_users_category() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (_token, bob_id) = register_named(&request, "bob").await;
        let bob_category =
            super::prepare_data::create_category(&ctx.db, &bob_id, "Bob 分類", 1).await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .delete(&format!("/api/v1/categories/{}", bob_category.id))
            .add_header(name, value)
            .await;
        assert_eq!(response.status_code(), 404);
    })
    .await;
}
