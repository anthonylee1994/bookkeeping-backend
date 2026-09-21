use std::collections::HashMap;

use axum::{
    extract::{Query, State},
    response::{IntoResponse, Response},
    Json,
};
use loco_rs::controller::Routes;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{error::ApiError, time, ApiResult, AuthUser};
use crate::app::AppContext;
use crate::models::_entities::{accounts, categories, recurring_rules, transactions};
use crate::views;

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/v1")
        .add("/dashboard", axum::routing::get(show))
}

#[derive(Deserialize)]
struct ShowParams {
    date: Option<String>,
}

pub struct CategoryTotals {
    pub income: i64,
    pub expense: i64,
}

pub fn category_totals(rows: &[transactions::Model]) -> HashMap<Option<String>, CategoryTotals> {
    let mut map: HashMap<Option<String>, CategoryTotals> = HashMap::new();
    for row in rows {
        if row.kind == 2 {
            continue;
        }
        let entry = map
            .entry(row.category_id.clone())
            .or_insert(CategoryTotals {
                income: 0,
                expense: 0,
            });
        if row.kind == 0 {
            entry.income += i64::from(row.amount_cents);
        } else if row.kind == 1 {
            entry.expense += i64::from(row.amount_cents);
        }
    }
    map
}

pub fn account_totals(rows: &[transactions::Model]) -> HashMap<String, CategoryTotals> {
    let mut map: HashMap<String, CategoryTotals> = HashMap::new();
    for row in rows {
        if row.kind == 2 {
            continue;
        }
        let entry = map.entry(row.account_id.clone()).or_insert(CategoryTotals {
            income: 0,
            expense: 0,
        });
        if row.kind == 0 {
            entry.income += i64::from(row.amount_cents);
        } else if row.kind == 1 {
            entry.expense += i64::from(row.amount_cents);
        }
    }
    map
}

pub fn sorted_category_rows(
    db_categories: &HashMap<String, String>,
    totals: HashMap<Option<String>, CategoryTotals>,
) -> Vec<Value> {
    let mut rows: Vec<Value> = totals
        .into_iter()
        .map(|(category_id, total)| {
            let name = category_id
                .as_ref()
                .and_then(|id| db_categories.get(id))
                .cloned();
            json!({
                "category_id": category_id,
                "name": name,
                "income_cents": total.income,
                "expense_cents": total.expense,
            })
        })
        .collect();
    rows.sort_by(|a, b| {
        let a_expense = a["expense_cents"].as_i64().unwrap_or(0);
        let b_expense = b["expense_cents"].as_i64().unwrap_or(0);
        let a_income = a["income_cents"].as_i64().unwrap_or(0);
        let b_income = b["income_cents"].as_i64().unwrap_or(0);
        b_expense.cmp(&a_expense).then(b_income.cmp(&a_income))
    });
    rows
}

async fn show(
    user: AuthUser,
    State(ctx): State<AppContext>,
    Query(params): Query<ShowParams>,
) -> ApiResult<Response> {
    let date = match params.date.as_deref().filter(|value| !value.is_empty()) {
        Some(value) => time::parse_date(value).ok_or_else(ApiError::invalid_value)?,
        None => time::today(),
    };
    let from = time::beginning_of_day(time::beginning_of_month(date));
    let to = time::end_of_day(time::end_of_month(date));

    let transactions_in_range = transactions::Entity::find()
        .filter(transactions::Column::UserId.eq(user.id()))
        .filter(transactions::Column::OccurredAt.gte(from))
        .filter(transactions::Column::OccurredAt.lte(to))
        .all(&ctx.db)
        .await?;

    let income: i64 = transactions_in_range
        .iter()
        .filter(|tx| tx.kind == 0)
        .map(|tx| i64::from(tx.amount_cents))
        .sum();
    let expense: i64 = transactions_in_range
        .iter()
        .filter(|tx| tx.kind == 1)
        .map(|tx| i64::from(tx.amount_cents))
        .sum();

    let recent = transactions::Entity::find()
        .filter(transactions::Column::UserId.eq(user.id()))
        .order_by_desc(transactions::Column::OccurredAt)
        .limit(10)
        .all(&ctx.db)
        .await?;
    let recent_rows: Vec<Value> = recent.iter().map(views::transaction_row).collect();

    let category_names = load_category_names(&ctx.db, user.id()).await?;
    let by_category =
        sorted_category_rows(&category_names, category_totals(&transactions_in_range));

    let balances = account_balances(&ctx, user.id()).await?;

    let now = time::now_local();
    let upcoming = recurring_rules::Entity::find()
        .filter(recurring_rules::Column::UserId.eq(user.id()))
        .filter(recurring_rules::Column::Status.eq(0))
        .filter(recurring_rules::Column::NextRunAt.gte(now))
        .filter(recurring_rules::Column::NextRunAt.lte(now + chrono::Duration::days(7)))
        .order_by_asc(recurring_rules::Column::NextRunAt)
        .all(&ctx.db)
        .await?;
    let reminders: Vec<Value> = upcoming.iter().map(views::rule_payload).collect();

    Ok(Json(json!({
        "data": {
            "range": {
                "from": time::format_datetime_seconds(&from),
                "to": time::format_datetime_seconds(&to),
            },
            "income_cents": income,
            "expense_cents": expense,
            "net_cents": income - expense,
            "recent_transactions": recent_rows,
            "by_category": by_category,
            "accounts": balances,
            "account_balances": balances,
            "upcoming_recurring": reminders,
            "recurring_reminders": reminders,
        }
    }))
    .into_response())
}

pub async fn load_category_names(
    db: &DatabaseConnection,
    user_id: &str,
) -> Result<HashMap<String, String>, ApiError> {
    let rows = categories::Entity::find()
        .filter(categories::Column::UserId.eq(user_id))
        .all(db)
        .await?;
    Ok(rows.into_iter().map(|row| (row.id, row.name)).collect())
}

async fn account_balances(ctx: &AppContext, user_id: &str) -> Result<Vec<Value>, ApiError> {
    let all_transactions = transactions::Entity::find()
        .filter(transactions::Column::UserId.eq(user_id))
        .all(&ctx.db)
        .await?;
    let totals = account_totals(&all_transactions);

    let accounts = accounts::Entity::find()
        .filter(accounts::Column::UserId.eq(user_id))
        .order_by_asc(accounts::Column::CreatedAt)
        .all(&ctx.db)
        .await?;

    Ok(accounts
        .iter()
        .map(|account| {
            let total = totals.get(&account.id);
            let income = total.map_or(0, |t| t.income);
            let expense = total.map_or(0, |t| t.expense);
            json!({
                "id": account.id,
                "name": account.name,
                "currency": account.currency,
                "initial_balance_cents": account.initial_balance_cents,
                "balance_cents": i64::from(account.initial_balance_cents) + income - expense,
            })
        })
        .collect())
}
