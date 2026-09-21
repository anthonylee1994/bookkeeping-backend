use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseConnection, DbErr,
    EntityTrait, QueryFilter, QueryOrder, TransactionTrait,
};

use super::_entities::{accounts, categories, users};
use crate::api::{auth, time, util};

pub use super::_entities::users::{ActiveModel, Entity, Model};

const DEFAULT_COLOR: &str = "#ecf0f1";

const DEFAULT_EXPENSE_CATEGORIES: &[(&str, &str)] = &[
    ("飲食", "mdi:food"),
    ("交通", "mdi:bus"),
    ("娛樂", "mdi:music"),
    ("購物", "mdi:cart"),
    ("醫療", "mdi:medical-bag"),
    ("住屋", "mdi:home"),
    ("水電", "mdi:lightning-bolt"),
    ("其他支出", "mdi:credit-card"),
];

const DEFAULT_INCOME_CATEGORIES: &[(&str, &str)] = &[
    ("薪水", "mdi:bank"),
    ("獎金", "mdi:gift"),
    ("投資", "mdi:piggy-bank"),
    ("兼職", "mdi:cash"),
    ("其他收入", "mdi:wallet"),
];

pub fn normalize_username(username: &str) -> String {
    username.trim().to_lowercase()
}

pub async fn find_by_username(
    db: &DatabaseConnection,
    username: &str,
) -> Result<Option<Model>, DbErr> {
    Entity::find()
        .filter(users::Column::Username.eq(normalize_username(username)))
        .one(db)
        .await
}

pub async fn find_by_id(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_string()).one(db).await
}

pub fn verify_password(user: &Model, password: &str) -> bool {
    auth::verify_password(password, &user.password_digest)
}

/// Registers a user and, in the same transaction, seeds the default cash
/// account and bookkeeping categories (mirrors the Rails `after_create`).
pub async fn create_user(
    db: &DatabaseConnection,
    username: &str,
    password: &str,
) -> Result<Model, DbErr> {
    let txn = db.begin().await?;
    let now = time::now_local();
    let user_id = util::new_id();

    let user = users::ActiveModel {
        id: Set(user_id.clone()),
        username: Set(normalize_username(username)),
        password_digest: Set(auth::hash_password(password).map_err(db_custom)?),
        timezone: Set("Asia/Hong_Kong".to_string()),
        currency: Set("HKD".to_string()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&txn)
    .await?;

    create_default_records(&txn, &user_id, "HKD", now).await?;

    txn.commit().await?;
    Ok(user)
}

async fn create_default_records<C: ConnectionTrait>(
    conn: &C,
    user_id: &str,
    currency: &str,
    now: chrono::NaiveDateTime,
) -> Result<(), DbErr> {
    accounts::ActiveModel {
        id: Set(util::new_id()),
        user_id: Set(user_id.to_string()),
        name: Set("現金".to_string()),
        kind: Set(0),
        icon: Set(Some("mdi:cash".to_string())),
        color: Set(Some(DEFAULT_COLOR.to_string())),
        initial_balance_cents: Set(0),
        currency: Set(currency.to_string()),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(conn)
    .await?;

    // Rails inserts each row with its own microsecond timestamp, and category
    // lists are ordered by `created_at`; stagger so the insertion order is
    // preserved here too.
    let mut tick: i64 = 1;
    for (kind, list) in [
        (1_i32, DEFAULT_EXPENSE_CATEGORIES),
        (0_i32, DEFAULT_INCOME_CATEGORIES),
    ] {
        for (name, icon) in list {
            let timestamp = now + chrono::Duration::microseconds(tick);
            tick += 1;
            categories::ActiveModel {
                id: Set(util::new_id()),
                user_id: Set(user_id.to_string()),
                name: Set((*name).to_string()),
                kind: Set(kind),
                icon: Set(Some((*icon).to_string())),
                color: Set(Some(DEFAULT_COLOR.to_string())),
                created_at: Set(timestamp),
                updated_at: Set(timestamp),
            }
            .insert(conn)
            .await?;
        }
    }

    Ok(())
}

pub async fn update_password(
    db: &DatabaseConnection,
    user: &Model,
    password: &str,
) -> Result<Model, DbErr> {
    let mut active: ActiveModel = user.clone().into();
    active.password_digest = Set(auth::hash_password(password).map_err(db_custom)?);
    active.updated_at = Set(time::now_local());
    active.update(db).await
}

pub async fn list_categories(
    db: &DatabaseConnection,
    user_id: &str,
) -> Result<Vec<categories::Model>, DbErr> {
    categories::Entity::find()
        .filter(categories::Column::UserId.eq(user_id))
        .order_by_asc(categories::Column::Kind)
        .order_by_asc(categories::Column::CreatedAt)
        .all(db)
        .await
}

fn db_custom<E: std::fmt::Display>(err: E) -> DbErr {
    DbErr::Custom(err.to_string())
}
