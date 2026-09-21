use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, DbErr, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait,
};

use crate::{
    api::{time, util},
    models::_entities::{recurring_occurrences, recurring_rules, transactions},
};

pub const FREQ_DAILY: i32 = 0;
pub const FREQ_WEEKLY: i32 = 1;
pub const FREQ_MONTHLY: i32 = 2;
pub const FREQ_YEARLY: i32 = 3;

pub const STATUS_ACTIVE: i32 = 0;
pub const STATUS_PAUSED: i32 = 1;
pub const STATUS_ENDED: i32 = 2;

pub const SOURCE_RECURRING: i32 = 1;

/// Clamps the day-of-month to the last valid day of the target month, the same
/// way Ruby's `Date#>>` does (`Jan 31 >> 1 == Feb 28`).
fn add_months(date: NaiveDate, months: i32) -> NaiveDate {
    let total = date.year() * 12 + (date.month0() as i32) + months;
    let year = total.div_euclid(12);
    let month = (total.rem_euclid(12) + 1) as u32;
    let last_day =
        time::end_of_month(NaiveDate::from_ymd_opt(year, month, 1).expect("valid year/month"))
            .day();
    let day = date.day().min(last_day);
    NaiveDate::from_ymd_opt(year, month, day).expect("valid date")
}

pub fn next_occurrence(from: NaiveDateTime, rule: &recurring_rules::Model) -> NaiveDateTime {
    let interval = rule.interval.max(1);
    match rule.frequency {
        FREQ_DAILY => from + Duration::days(i64::from(interval)),
        FREQ_WEEKLY => {
            let target = rule
                .day_of_week
                .unwrap_or(from.weekday().num_days_from_sunday() as i32);
            let candidate = from + Duration::weeks(i64::from(interval));
            let current = candidate.weekday().num_days_from_sunday() as i32;
            let delta = (target - current).rem_euclid(7);
            candidate + Duration::days(i64::from(delta))
        }
        FREQ_MONTHLY => {
            let date = add_months(from.date(), interval);
            let day = rule.day_of_month.unwrap_or_else(|| from.day() as i32);
            let day = day.min(time::end_of_month(date).day() as i32).max(1) as u32;
            NaiveDate::from_ymd_opt(date.year(), date.month(), day)
                .expect("valid monthly date")
                .and_time(from.time())
        }
        FREQ_YEARLY => {
            let date = from.date();
            let year = date.year() + interval;
            let month = rule.month_of_year.map_or(date.month(), |v| v as u32);
            let first = NaiveDate::from_ymd_opt(year, month, 1).expect("valid yearly month");
            let last_day = time::end_of_month(first).day();
            let day = rule
                .day_of_month
                .map_or(date.day(), |v| v as u32)
                .min(last_day);
            NaiveDate::from_ymd_opt(year, month, day)
                .expect("valid yearly date")
                .and_time(from.time())
        }
        _ => from + Duration::days(i64::from(interval)),
    }
}

fn backfill_enabled() -> bool {
    util::env_bool("RECURRING_BACKFILL_ENABLED", false)
}

fn backfill_limit() -> i64 {
    util::env_i64("RECURRING_BACKFILL_MAX_DAYS", 90).max(1)
}

/// Request-time catch-up (no background worker): called for every authenticated
/// request before the handler runs.
pub async fn catch_up(db: &DatabaseConnection, user_id: &str) {
    let now = time::now_local();
    let rules = match recurring_rules::Entity::find()
        .filter(recurring_rules::Column::UserId.eq(user_id))
        .filter(recurring_rules::Column::Status.eq(STATUS_ACTIVE))
        .filter(recurring_rules::Column::NextRunAt.lte(now))
        .order_by_asc(recurring_rules::Column::NextRunAt)
        .all(db)
        .await
    {
        Ok(rules) => rules,
        Err(err) => {
            tracing::warn!(error = %err, "recurring catch-up query failed");
            return;
        }
    };

    for rule in rules {
        if let Err(err) = process_rule(db, user_id, &rule, now).await {
            tracing::warn!(error = %err, rule_id = %rule.id, "recurring catch-up failed");
        }
    }
}

async fn process_rule(
    db: &DatabaseConnection,
    user_id: &str,
    rule: &recurring_rules::Model,
    now: NaiveDateTime,
) -> Result<(), DbErr> {
    let mut due: Vec<NaiveDateTime> = Vec::new();
    let mut cursor = rule.next_run_at;
    let backfill = backfill_enabled();
    let cutoff = now.date() - Duration::days(backfill_limit());

    while cursor <= now {
        if let Some(end_on) = rule.end_on {
            if cursor.date() > end_on {
                break;
            }
        }
        due.push(cursor);
        cursor = next_occurrence(cursor, rule);
        if backfill && cursor.date() < cutoff {
            break;
        }
    }

    if due.is_empty() {
        return Ok(());
    }

    if backfill {
        let skipped = due.iter().filter(|run_at| run_at.date() < cutoff).count();
        if skipped > 0 {
            tracing::warn!(rule_id = %rule.id, skipped, "recurring backfill limit reached");
        }
        due.retain(|run_at| run_at.date() >= cutoff);
    }

    // Without backfill only the most recent due occurrence is materialized;
    // every occurrence is still recorded in `recurring_occurrences`.
    let first_materialized = if backfill {
        0
    } else {
        due.len().saturating_sub(1)
    };
    for (index, run_at) in due.iter().enumerate() {
        record_occurrence(db, user_id, rule, *run_at, index >= first_materialized, now).await?;
    }

    let mut active: recurring_rules::ActiveModel = rule.clone().into();
    active.last_run_at = Set(Some(now));
    active.next_run_at = Set(cursor);
    active.updated_at = Set(now);
    if let Some(end_on) = rule.end_on {
        if cursor.date() > end_on {
            active.status = Set(STATUS_ENDED);
        }
    }
    active.update(db).await?;

    Ok(())
}

/// Builds the transaction a rule materializes for a single `occurred_at`.
fn base_transaction(
    user_id: &str,
    rule: &recurring_rules::Model,
    occurred_at: NaiveDateTime,
    now: NaiveDateTime,
) -> transactions::ActiveModel {
    transactions::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user_id.to_string()),
        account_id: Set(rule.account_id.clone()),
        category_id: Set(rule.category_id.clone()),
        merchant_id: Set(rule.merchant_id.clone()),
        kind: Set(rule.kind),
        amount_cents: Set(rule.amount_cents),
        currency: Set(rule.currency.clone()),
        occurred_at: Set(occurred_at),
        note: Set(rule.note.clone()),
        payment_method: Set(None),
        image_urls: Set(serde_json::json!([])),
        source: Set(SOURCE_RECURRING),
        transfer_account_id: Set(None),
        idempotency_key: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
}

async fn record_occurrence(
    db: &DatabaseConnection,
    user_id: &str,
    rule: &recurring_rules::Model,
    run_at: NaiveDateTime,
    materialize: bool,
    now: NaiveDateTime,
) -> Result<(), DbErr> {
    let existing = recurring_occurrences::Entity::find()
        .filter(recurring_occurrences::Column::RecurringRuleId.eq(&rule.id))
        .filter(recurring_occurrences::Column::OccurredOn.eq(run_at.date()))
        .one(db)
        .await?;
    if existing.is_some() {
        return Ok(());
    }

    let occurrence_id = util::new_id();
    recurring_occurrences::ActiveModel {
        id: Set(occurrence_id.clone()),
        recurring_rule_id: Set(rule.id.clone()),
        occurred_on: Set(run_at.date()),
        transaction_id: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await?;

    if !materialize {
        return Ok(());
    }

    let transaction = base_transaction(user_id, rule, run_at, now)
        .insert(db)
        .await?;

    let mut occurrence: recurring_occurrences::ActiveModel =
        recurring_occurrences::Entity::find_by_id(occurrence_id)
            .one(db)
            .await?
            .expect("occurrence just inserted")
            .into();
    occurrence.transaction_id = Set(Some(transaction.id));
    occurrence.updated_at = Set(now);
    occurrence.update(db).await?;

    Ok(())
}

/// Manual `run_now`: build a transaction for today's occurrence unless it was
/// already materialized.
pub async fn run_now(
    db: &DatabaseConnection,
    user_id: &str,
    rule: &recurring_rules::Model,
) -> Result<Option<transactions::Model>, RunNowError> {
    let now = time::now_local();
    let today = now.date();
    let txn = db.begin().await?;

    let occurrence = recurring_occurrences::Entity::find()
        .filter(recurring_occurrences::Column::RecurringRuleId.eq(&rule.id))
        .filter(recurring_occurrences::Column::OccurredOn.eq(today))
        .one(&txn)
        .await?;

    if let Some(existing) = &occurrence {
        if existing.transaction_id.is_some() {
            txn.rollback().await?;
            return Err(RunNowError::AlreadyMaterialized);
        }
    }

    let occurrence_id = match &occurrence {
        Some(existing) => existing.id.clone(),
        None => {
            let id = util::new_id();
            recurring_occurrences::ActiveModel {
                id: Set(id.clone()),
                recurring_rule_id: Set(rule.id.clone()),
                occurred_on: Set(today),
                transaction_id: Set(None),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(&txn)
            .await?;
            id
        }
    };

    let transaction = base_transaction(user_id, rule, now, now)
        .insert(&txn)
        .await?;

    let mut occurrence_active: recurring_occurrences::ActiveModel =
        recurring_occurrences::Entity::find_by_id(occurrence_id)
            .one(&txn)
            .await?
            .expect("occurrence available")
            .into();
    occurrence_active.transaction_id = Set(Some(transaction.id.clone()));
    occurrence_active.updated_at = Set(now);
    occurrence_active.update(&txn).await?;

    txn.commit().await?;
    Ok(Some(transaction))
}

#[derive(Debug, thiserror::Error)]
pub enum RunNowError {
    #[error("already materialized")]
    AlreadyMaterialized,
    #[error(transparent)]
    Db(#[from] DbErr),
}

/// `skip_next`: record the next occurrence without a transaction and advance
/// `next_run_at`.
pub async fn skip_next(
    db: &DatabaseConnection,
    rule: &recurring_rules::Model,
) -> Result<recurring_rules::Model, DbErr> {
    let now = time::now_local();
    let next_date = rule.next_run_at.date();

    let existing = recurring_occurrences::Entity::find()
        .filter(recurring_occurrences::Column::RecurringRuleId.eq(&rule.id))
        .filter(recurring_occurrences::Column::OccurredOn.eq(next_date))
        .one(db)
        .await?;

    match existing {
        Some(occurrence) => {
            let mut active: recurring_occurrences::ActiveModel = occurrence.into();
            active.transaction_id = Set(None);
            active.updated_at = Set(now);
            active.update(db).await?;
        }
        None => {
            recurring_occurrences::ActiveModel {
                id: Set(util::new_id()),
                recurring_rule_id: Set(rule.id.clone()),
                occurred_on: Set(next_date),
                transaction_id: Set(None),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(db)
            .await?;
        }
    }

    let mut active: recurring_rules::ActiveModel = rule.clone().into();
    active.last_run_at = Set(Some(now));
    active.next_run_at = Set(next_occurrence(rule.next_run_at, rule));
    active.updated_at = Set(now);
    active.update(db).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn rule(
        frequency: i32,
        interval: i32,
        day_of_week: Option<i32>,
        day_of_month: Option<i32>,
        month_of_year: Option<i32>,
    ) -> recurring_rules::Model {
        let start = NaiveDate::from_ymd_opt(2026, 1, 1).expect("valid date");
        recurring_rules::Model {
            id: "rule".to_string(),
            user_id: "user".to_string(),
            account_id: "account".to_string(),
            category_id: None,
            merchant_id: None,
            kind: 1,
            amount_cents: 1000,
            currency: "HKD".to_string(),
            frequency,
            interval,
            day_of_week,
            day_of_month,
            month_of_year,
            start_on: start,
            end_on: None,
            next_run_at: time::beginning_of_day(start),
            last_run_at: None,
            status: STATUS_ACTIVE,
            note: None,
            created_at: time::beginning_of_day(start),
            updated_at: time::beginning_of_day(start),
        }
    }

    fn at(year: i32, month: u32, day: u32, hour: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(year, month, day)
            .expect("valid date")
            .and_hms_opt(hour, 0, 0)
            .expect("valid time")
    }

    #[test]
    fn monthly_day_31_clamps_to_february_last_day() {
        let rule = rule(FREQ_MONTHLY, 1, None, Some(31), None);
        let next = next_occurrence(at(2026, 1, 31, 9), &rule);
        assert_eq!(next.date(), NaiveDate::from_ymd_opt(2026, 2, 28).unwrap());
    }

    #[test]
    fn daily_respects_interval() {
        let rule = rule(FREQ_DAILY, 2, None, None, None);
        let next = next_occurrence(at(2026, 1, 1, 0), &rule);
        assert_eq!(next.date(), NaiveDate::from_ymd_opt(2026, 1, 3).unwrap());
    }

    #[test]
    fn yearly_day_29_clamps_in_non_leap_year() {
        let rule = rule(FREQ_YEARLY, 1, None, Some(29), Some(2));
        let next = next_occurrence(at(2026, 2, 28, 0), &rule);
        assert_eq!(next.date(), NaiveDate::from_ymd_opt(2027, 2, 28).unwrap());
    }

    #[test]
    fn weekly_keeps_the_configured_weekday() {
        // 2026-09-14 is a Monday; next weekly should land on the next Monday.
        let rule = rule(FREQ_WEEKLY, 1, Some(1), None, None);
        let next = next_occurrence(at(2026, 9, 14, 10), &rule);
        assert_eq!(next.date(), NaiveDate::from_ymd_opt(2026, 9, 21).unwrap());
    }

    #[test]
    fn monthly_defaults_to_the_current_day() {
        let rule = rule(FREQ_MONTHLY, 1, None, None, None);
        let next = next_occurrence(at(2026, 1, 15, 8), &rule);
        assert_eq!(next.date(), NaiveDate::from_ymd_opt(2026, 2, 15).unwrap());
    }
}
