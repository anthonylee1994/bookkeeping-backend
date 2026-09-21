use loco_rs::testing::prelude::*;
use serial_test::serial;

use bookkeeping_backend::app::App;

use super::prepare_data::{
    at, auth_header, create_account, create_rule, create_transaction, json_body, register_and_login,
};

#[tokio::test]
#[serial]
async fn daily_totals_exclude_transfers() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let savings = create_account(&ctx.db, &fixture.user_id, "Savings", 1).await;

        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            100_000,
            at(2026, 9, 14, 10, 0),
            None,
            None,
            None,
            0,
        )
        .await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            1,
            50_000,
            at(2026, 9, 14, 11, 0),
            Some(fixture.expense_category_id.clone()),
            None,
            None,
            0,
        )
        .await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            2,
            20_000,
            at(2026, 9, 14, 12, 0),
            None,
            None,
            Some(savings.id.clone()),
            0,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .get("/api/v1/summaries/daily?date=2026-09-14")
            .add_header(name, value)
            .await;
        assert_eq!(response.status_code(), 200);
        let body = json_body(&response.text());
        let data = &body["data"];
        assert_eq!(data["income_cents"], 100_000);
        assert_eq!(data["expense_cents"], 50_000);
        assert_eq!(data["net_cents"], 50_000);
        assert_eq!(data["transfers"]["count"], 1);
        assert_eq!(data["transfers"]["total_cents"], 20_000);
        assert_eq!(data["by_category"][0]["expense_cents"], 50_000);
        let income_sum: i64 = data["by_category"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["income_cents"].as_i64().unwrap())
            .sum();
        assert_eq!(income_sum, 100_000);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn daily_boundaries_use_hong_kong_time() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            1_000,
            at(2026, 9, 14, 23, 59),
            None,
            None,
            None,
            0,
        )
        .await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            2_000,
            at(2026, 9, 15, 0, 0),
            None,
            None,
            None,
            0,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        let first = request
            .get("/api/v1/summaries/daily?date=2026-09-14")
            .add_header(name.clone(), value.clone())
            .await;
        assert_eq!(json_body(&first.text())["data"]["income_cents"], 1_000);
        let second = request
            .get("/api/v1/summaries/daily?date=2026-09-15")
            .add_header(name, value)
            .await;
        assert_eq!(json_body(&second.text())["data"]["income_cents"], 2_000);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn weekly_is_monday_to_sunday_and_monthly_uses_month_boundaries() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        for (day, amount) in [(13, 1_000), (14, 2_000), (20, 3_000), (21, 4_000)] {
            create_transaction(
                &ctx.db,
                &fixture.user_id,
                &fixture.account_id,
                0,
                amount,
                at(2026, 9, day, 12, 0),
                None,
                None,
                None,
                0,
            )
            .await;
        }
        let (name, value) = auth_header(&fixture.token);

        let first_week = request
            .get("/api/v1/summaries/weekly?date=2026-09-14")
            .add_header(name.clone(), value.clone())
            .await;
        assert_eq!(json_body(&first_week.text())["data"]["income_cents"], 5_000);

        let second_week = request
            .get("/api/v1/summaries/weekly?date=2026-09-21")
            .add_header(name.clone(), value.clone())
            .await;
        assert_eq!(
            json_body(&second_week.text())["data"]["income_cents"],
            4_000
        );

        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            5_000,
            at(2026, 9, 30, 23, 59),
            None,
            None,
            None,
            0,
        )
        .await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            6_000,
            at(2026, 10, 1, 0, 0),
            None,
            None,
            None,
            0,
        )
        .await;
        let monthly = request
            .get("/api/v1/summaries/monthly?date=2026-09-14")
            .add_header(name, value)
            .await;
        assert_eq!(json_body(&monthly.text())["data"]["income_cents"], 15_000);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn paginates_summary_transactions() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        for index in 0..3 {
            create_transaction(
                &ctx.db,
                &fixture.user_id,
                &fixture.account_id,
                1,
                1_000 + index,
                at(2026, 9, 14, 10 + index as u32, 0),
                None,
                None,
                None,
                0,
            )
            .await;
        }
        let (name, value) = auth_header(&fixture.token);
        let response = request
            .get("/api/v1/summaries/daily?date=2026-09-14&page=2&per_page=2")
            .add_header(name, value)
            .await;
        let body = json_body(&response.text());
        let transactions = &body["data"]["transactions"];
        assert_eq!(transactions["data"].as_array().unwrap().len(), 1);
        assert_eq!(transactions["meta"]["total"], 3);
        assert_eq!(transactions["meta"]["total_pages"], 2);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn monthly_returns_daily_breakdown() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let savings = create_account(&ctx.db, &fixture.user_id, "Savings", 1).await;

        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            1_000,
            at(2026, 9, 1, 10, 0),
            None,
            None,
            None,
            0,
        )
        .await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            1,
            400,
            at(2026, 9, 1, 11, 0),
            None,
            None,
            None,
            0,
        )
        .await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            2_000,
            at(2026, 9, 3, 9, 0),
            None,
            None,
            None,
            0,
        )
        .await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            2,
            5_000,
            at(2026, 9, 3, 12, 0),
            None,
            None,
            Some(savings.id.clone()),
            0,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .get("/api/v1/summaries/monthly?date=2026-09-14")
            .add_header(name, value)
            .await;
        let body = json_body(&response.text());
        let daily = body["data"]["daily"].as_array().unwrap();
        assert_eq!(daily.len(), 2);
        assert_eq!(daily[0]["date"], "2026-09-01");
        assert_eq!(daily[0]["net_cents"], 600);
        assert_eq!(daily[1]["date"], "2026-09-03");
        assert_eq!(daily[1]["net_cents"], 2_000);
        assert_eq!(daily[0].as_object().unwrap().len(), 2);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn dashboard_returns_monthly_metrics_and_reminders() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            10_000,
            at(2026, 9, 10, 12, 0),
            None,
            None,
            None,
            0,
        )
        .await;
        create_transaction(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            1,
            3_000,
            at(2026, 9, 11, 12, 0),
            None,
            None,
            None,
            0,
        )
        .await;

        create_rule(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            bookkeeping_backend::api::time::now_local() + chrono::Duration::days(3),
            None,
            None,
        )
        .await;
        create_rule(
            &ctx.db,
            &fixture.user_id,
            &fixture.account_id,
            0,
            bookkeeping_backend::api::time::now_local() + chrono::Duration::days(8),
            None,
            None,
        )
        .await;

        let (name, value) = auth_header(&fixture.token);
        let response = request
            .get("/api/v1/dashboard?date=2026-09-14")
            .add_header(name, value)
            .await;
        assert_eq!(response.status_code(), 200);
        let body = json_body(&response.text());
        let data = &body["data"];
        assert_eq!(data["income_cents"], 10_000);
        assert_eq!(data["expense_cents"], 3_000);
        assert_eq!(data["net_cents"], 7_000);
        assert_eq!(data["recent_transactions"].as_array().unwrap().len(), 2);
        assert_eq!(data["recurring_reminders"].as_array().unwrap().len(), 1);
        assert_eq!(data["upcoming_recurring"].as_array().unwrap().len(), 1);
    })
    .await;
}
