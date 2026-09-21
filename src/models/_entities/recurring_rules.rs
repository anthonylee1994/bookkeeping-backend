use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "recurring_rules")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub user_id: String,
    pub account_id: String,
    pub category_id: Option<String>,
    pub merchant_id: Option<String>,
    pub kind: i32,
    pub amount_cents: i32,
    pub currency: String,
    pub frequency: i32,
    pub interval: i32,
    pub day_of_week: Option<i32>,
    pub day_of_month: Option<i32>,
    pub month_of_year: Option<i32>,
    pub start_on: Date,
    pub end_on: Option<Date>,
    pub next_run_at: DateTime,
    pub last_run_at: Option<DateTime>,
    pub status: i32,
    pub note: Option<String>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::UserId",
        to = "super::users::Column::Id"
    )]
    User,
    #[sea_orm(
        belongs_to = "super::accounts::Entity",
        from = "Column::AccountId",
        to = "super::accounts::Column::Id"
    )]
    Account,
    #[sea_orm(
        belongs_to = "super::categories::Entity",
        from = "Column::CategoryId",
        to = "super::categories::Column::Id"
    )]
    Category,
    #[sea_orm(
        belongs_to = "super::merchants::Entity",
        from = "Column::MerchantId",
        to = "super::merchants::Column::Id"
    )]
    Merchant,
    #[sea_orm(has_many = "super::recurring_occurrences::Entity")]
    RecurringOccurrences,
}

impl Related<super::recurring_occurrences::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RecurringOccurrences.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
