use chrono::Duration;
use loco_rs::testing::prelude::*;
use serial_test::serial;

use bookkeeping_backend::api::time;
use bookkeeping_backend::app::App;

use super::prepare_data::{
    auth_header, count_occurrences, count_occurrences_without_transaction, count_transactions,
    create_rule, find_rule, json_body, list_transactions, register_and_login,
};

fn in_hours(hours: i64) -> String {
    time::format_datetime(&(time::now_local() + Duration::hours(hours)))
}

#[tokio::test]
#[serial]
async fn creates_and_pauses_resumes_a_rule() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let created = request
            .post("/api/v1/recurring_rules")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({
                "account_id": fixture.account_id,
                "kind": "expense",
                "amount_cents": 1000,
                "frequency": "daily",
                "interval": 1,
                "start_on": time::today().to_string(),
                "next_run_at": in_hours(1)
            }))
            .await;
        assert_eq!(created.status_code(), 201);
        let id = json_body(&created.text())["data"]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let paused = request
            .post(&format!("/api/v1/recurring_rules/{id}/pause"))
            .add_header(name.clone(), value.clone())
            .await;
        assert_eq!(json_body(&paused.text())["data"]["status"], "paused");

        let resumed = request
            .post(&format!("/api/v1/recurring_rules/{id}/resume"))
            .add_header(name, value)
            .await;
        assert_eq!(json_body(&resumed.text())["data"]["status"], "active");
    })
    .await;
}

#[tokio::test]
#[serial]
async fn updates_a_rule_and_clears_nullable_fields() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let created = request
            .post("/api/v1/recurring_rules")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({
                "account_id": fixture.account_id,
                "category_id": fixture.expense_category_id,
                "kind": "expense",
                "amount_cents": 1000,
                "frequency": "daily",
                "interval": 1,
                "start_on": time::today().to_string(),
                "note": "before",
                "next_run_at": in_hours(1)
            }))
            .await;
        assert_eq!(created.status_code(), 201);
        let id = json_body(&created.text())["data"]["id"]
            .as_str()
            .unwrap()
            .to_string();

        // Partial update: changed fields apply, omitted fields stay.
        let updated = request
            .patch(&format!("/api/v1/recurring_rules/{id}"))
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({ "amount_cents": 2500, "note": "after" }))
            .await;
        assert_eq!(updated.status_code(), 200);
        let body = json_body(&updated.text());
        assert_eq!(body["data"]["amount_cents"], 2500);
        assert_eq!(body["data"]["note"], "after");
        assert_eq!(body["data"]["interval"], 1);
        assert_eq!(body["data"]["frequency"], "daily");

        // Explicit null clears the nullable category; omitting it would not.
        let cleared = request
            .patch(&format!("/api/v1/recurring_rules/{id}"))
            .add_header(name, value)
            .json(&serde_json::json!({ "category_id": null }))
            .await;
        assert_eq!(cleared.status_code(), 200);
        assert!(json_body(&cleared.text())["data"]["category_id"].is_null());
    })
    .await;
}

#[tokio::test]
#[serial]
async fn rejects_invalid_rule_updates() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let rule = create_rule(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            time::now_local() + Duration::hours(1),
            None,
            None,
        )
        .await;

        let response = request
            .patch(&format!("/api/v1/recurring_rules/{}", rule.id))
            .add_header(name, value)
            .json(&serde_json::json!({ "amount_cents": 0, "interval": 0 }))
            .await;
        assert_eq!(response.status_code(), 422);
        let body = json_body(&response.text());
        assert_eq!(body["error"]["code"], "validation_error");
    })
    .await;
}

#[tokio::test]
#[serial]
async fn lists_and_filters_rules_by_status() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        create_rule(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            time::now_local() + Duration::hours(1),
            None,
            Some("active rule".to_string()),
        )
        .await;
        create_rule(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            1,
            time::now_local() + Duration::hours(1),
            None,
            Some("paused rule".to_string()),
        )
        .await;
        let (name, value) = auth_header(&fixture.token);

        let all = request
            .get("/api/v1/recurring_rules")
            .add_header(name.clone(), value.clone())
            .await;
        let notes: Vec<String> = json_body(&all.text())["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["note"].as_str().unwrap().to_string())
            .collect();
        assert!(notes.contains(&"active rule".to_string()));
        assert!(notes.contains(&"paused rule".to_string()));

        let paused = request
            .get("/api/v1/recurring_rules?status=paused")
            .add_header(name.clone(), value.clone())
            .await;
        let rows = json_body(&paused.text());
        let rows = rows["data"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["note"], "paused rule");

        let ended = request
            .get("/api/v1/recurring_rules?status=ended")
            .add_header(name.clone(), value.clone())
            .await;
        assert!(json_body(&ended.text())["data"]
            .as_array()
            .unwrap()
            .is_empty());

        let bogus = request
            .get("/api/v1/recurring_rules?status=bogus")
            .add_header(name, value)
            .await;
        assert_eq!(bogus.status_code(), 200);
        assert!(json_body(&bogus.text())["data"]
            .as_array()
            .unwrap()
            .is_empty());
    })
    .await;
}

#[tokio::test]
#[serial]
async fn run_now_materializes_once_then_conflicts() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let (name, value) = auth_header(&fixture.token);
        let created = request
            .post("/api/v1/recurring_rules")
            .add_header(name.clone(), value.clone())
            .json(&serde_json::json!({
                "account_id": fixture.account_id,
                "kind": "expense",
                "amount_cents": 1000,
                "frequency": "daily",
                "interval": 1,
                "start_on": time::today().to_string(),
                "next_run_at": in_hours(1)
            }))
            .await;
        let id = json_body(&created.text())["data"]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let first = request
            .post(&format!("/api/v1/recurring_rules/{id}/run_now"))
            .add_header(name.clone(), value.clone())
            .await;
        assert_eq!(first.status_code(), 200);
        assert_eq!(json_body(&first.text())["data"]["net_amount_cents"], 1000);

        let second = request
            .post(&format!("/api/v1/recurring_rules/{id}/run_now"))
            .add_header(name, value)
            .await;
        assert_eq!(second.status_code(), 409);
        assert_eq!(
            json_body(&second.text())["error"]["code"],
            "already_materialized"
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn catch_up_materializes_exactly_once() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        create_rule(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            time::now_local() - Duration::days(2),
            None,
            None,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        request
            .get("/api/v1/me")
            .add_header(name.clone(), value.clone())
            .await;
        let count = count_transactions(&ctx.db, &fixture.user_id, 1).await;
        assert!(count >= 1);

        request.get("/api/v1/me").add_header(name, value).await;
        assert_eq!(
            count_transactions(&ctx.db, &fixture.user_id, 1).await,
            count
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn skip_next_does_not_create_a_transaction() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let rule = create_rule(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            time::now_local() + Duration::hours(1),
            None,
            None,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .post(&format!("/api/v1/recurring_rules/{}/skip_next", rule.id))
            .add_header(name, value)
            .await;
        assert_eq!(response.status_code(), 200);
        assert_eq!(
            count_occurrences_without_transaction(&ctx.db, &rule.id).await,
            1
        );
        assert_eq!(count_transactions(&ctx.db, &fixture.user_id, 1).await, 0);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn does_not_recreate_a_deleted_recurring_transaction() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let rule = create_rule(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            time::now_local() - Duration::hours(1),
            None,
            None,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        request
            .get("/api/v1/me")
            .add_header(name.clone(), value.clone())
            .await;

        let transactions = list_transactions(&ctx.db, &fixture.user_id, 1).await;
        assert_eq!(transactions.len(), 1);
        let deleted = request
            .delete(&format!("/api/v1/transactions/{}", transactions[0].id))
            .add_header(name.clone(), value.clone())
            .await;
        assert_eq!(deleted.status_code(), 204);

        request.get("/api/v1/me").add_header(name, value).await;
        assert_eq!(count_transactions(&ctx.db, &fixture.user_id, 1).await, 0);
        assert!(count_occurrences_without_transaction(&ctx.db, &rule.id).await >= 1);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn ends_a_rule_after_its_end_date() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let rule = create_rule(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            time::now_local() - Duration::days(2),
            Some(time::today() - Duration::days(1)),
            None,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        request.get("/api/v1/me").add_header(name, value).await;
        assert_eq!(find_rule(&ctx.db, &rule.id).await.status, 2);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn backfill_disabled_materializes_only_the_latest_occurrence() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let rule = create_rule(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            time::now_local() - Duration::days(3),
            None,
            None,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        request.get("/api/v1/me").add_header(name, value).await;

        assert_eq!(count_occurrences(&ctx.db, &rule.id).await, 4);
        assert_eq!(count_transactions(&ctx.db, &fixture.user_id, 1).await, 1);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn backfill_enabled_materializes_every_due_occurrence() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let rule = create_rule(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            time::now_local() - Duration::days(3),
            None,
            None,
        )
        .await;

        std::env::set_var("RECURRING_BACKFILL_ENABLED", "true");
        let (name, value) = auth_header(&fixture.token);
        request.get("/api/v1/me").add_header(name, value).await;
        std::env::remove_var("RECURRING_BACKFILL_ENABLED");

        assert_eq!(count_occurrences(&ctx.db, &rule.id).await, 4);
        assert_eq!(count_transactions(&ctx.db, &fixture.user_id, 1).await, 4);
    })
    .await;
}
