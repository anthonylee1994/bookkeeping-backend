use std::collections::BTreeMap;

use axum::{
    extract::{Query, State},
    response::{IntoResponse, Response},
    Json,
};
use chrono::NaiveDate;
use loco_rs::controller::Routes;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{error::ApiError, time, util, ApiResult, AuthUser};
use crate::app::AppContext;
use crate::models::_entities::transactions;
use crate::views;

use super::dashboard::{
    account_totals, category_totals, load_category_names, sorted_category_rows,
};

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/v1")
        .add("/summaries/daily", axum::routing::get(daily))
        .add("/summaries/weekly", axum::routing::get(weekly))
        .add("/summaries/monthly", axum::routing::get(monthly))
}

#[derive(Deserialize)]
struct SummaryParams {
    date: Option<String>,
    page: Option<String>,
    per_page: Option<String>,
}

#[derive(Clone, Copy)]
enum Period {
    Daily,
    Weekly,
    Monthly,
}

async fn daily(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Query(params): Query<SummaryParams>,
) -> ApiResult<Response> {
    summarize(user, ctx, params, Period::Daily).await
}

async fn weekly(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Query(params): Query<SummaryParams>,
) -> ApiResult<Response> {
    summarize(user, ctx, params, Period::Weekly).await
}

async fn monthly(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Query(params): Query<SummaryParams>,
) -> ApiResult<Response> {
    summarize(user, ctx, params, Period::Monthly).await
}

async fn summarize(
    user: AuthUser,
    ctx: AppContext,
    params: SummaryParams,
    period: Period,
) -> ApiResult<Response> {
    let date = match params.date.as_deref().filter(|value| !value.is_empty()) {
        Some(value) => time::parse_date(value).ok_or_else(ApiError::invalid_value)?,
        None => time::today(),
    };
    let (from, to) = boundaries(period, date);

    let scope = transactions::Entity::find()
        .filter(transactions::Column::UserId.eq(user.id()))
        .filter(transactions::Column::OccurredAt.gte(from))
        .filter(transactions::Column::OccurredAt.lte(to))
        .all(&ctx.db)
        .await?;

    let regular: Vec<transactions::Model> =
        scope.iter().filter(|tx| tx.kind != 2).cloned().collect();
    let transfers: Vec<&transactions::Model> = scope.iter().filter(|tx| tx.kind == 2).collect();

    let income: i64 = regular
        .iter()
        .filter(|tx| tx.kind == 0)
        .map(|tx| i64::from(tx.amount_cents))
        .sum();
    let expense: i64 = regular
        .iter()
        .filter(|tx| tx.kind == 1)
        .map(|tx| i64::from(tx.amount_cents))
        .sum();

    let category_names = load_category_names(&ctx.db, user.id()).await?;
    let by_category = sorted_category_rows(&category_names, category_totals(&regular));

    let account_totals_map = account_totals(&regular);
    let account_names = crate::models::_entities::accounts::Entity::find()
        .filter(crate::models::_entities::accounts::Column::UserId.eq(user.id()))
        .all(&ctx.db)
        .await?
        .into_iter()
        .map(|account| (account.id, account.name))
        .collect::<std::collections::HashMap<_, _>>();
    let mut by_account: Vec<Value> = account_totals_map
        .into_iter()
        .map(|(account_id, total)| {
            let name = account_names.get(&account_id).cloned();
            json!({
                "account_id": account_id,
                "name": name,
                "income_cents": total.income,
                "expense_cents": total.expense,
            })
        })
        .collect();
    by_account.sort_by_key(|row| row["account_id"].as_str().unwrap_or_default().to_string());

    let daily_breakdown = daily_breakdown(&regular);

    let page = util::clamp_page(params.page.as_deref());
    let per_page = util::clamp_per_page(params.per_page.as_deref());
    let total = regular.len() as i64;
    let mut ordered = regular.clone();
    ordered.sort_by_key(|row| std::cmp::Reverse(row.occurred_at));
    let start = ((page - 1) * per_page) as usize;
    let end = ((page - 1) * per_page + per_page) as usize;
    let page_rows: Vec<Value> = ordered
        .iter()
        .skip(start)
        .take(end.saturating_sub(start))
        .map(views::transaction_row)
        .collect();

    Ok(Json(json!({
        "data": {
            "range": {
                "from": time::format_datetime_seconds(&from),
                "to": time::format_datetime_seconds(&to),
            },
            "income_cents": income,
            "expense_cents": expense,
            "net_cents": income - expense,
            "daily": daily_breakdown,
            "by_category": by_category,
            "by_account": by_account,
            "transfers": {
                "count": transfers.len(),
                "total_cents": transfers.iter().map(|tx| i64::from(tx.amount_cents)).sum::<i64>(),
            },
            "transactions": {
                "data": page_rows,
                "meta": {
                    "page": page,
                    "per_page": per_page,
                    "total": total,
                    "total_pages": ((total as f64) / (per_page as f64)).ceil() as i64,
                }
            }
        }
    }))
    .into_response())
}

fn boundaries(period: Period, date: NaiveDate) -> (chrono::NaiveDateTime, chrono::NaiveDateTime) {
    let (first, last) = match period {
        Period::Daily => (date, date),
        Period::Weekly => (
            time::beginning_of_week_monday(date),
            time::end_of_week_monday(date),
        ),
        Period::Monthly => (time::beginning_of_month(date), time::end_of_month(date)),
    };
    (time::beginning_of_day(first), time::end_of_day(last))
}

fn daily_breakdown(rows: &[transactions::Model]) -> Vec<Value> {
    let mut map: BTreeMap<NaiveDate, i64> = BTreeMap::new();
    for row in rows {
        let entry = map.entry(row.occurred_at.date()).or_insert(0);
        let amount = i64::from(row.amount_cents);
        if row.kind == 0 {
            *entry += amount;
        } else if row.kind == 1 {
            *entry -= amount;
        }
    }
    map.into_iter()
        .map(|(date, net)| json!({ "date": time::format_date(&date), "net_cents": net }))
        .collect()
}
