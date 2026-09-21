use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "transactions")]
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
    pub occurred_at: DateTime,
    pub note: Option<String>,
    pub payment_method: Option<String>,
    pub image_urls: Json,
    pub source: i32,
    pub transfer_account_id: Option<String>,
    pub idempotency_key: Option<String>,
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
        belongs_to = "super::accounts::Entity",
        from = "Column::TransferAccountId",
        to = "super::accounts::Column::Id"
    )]
    TransferAccount,
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
}

impl Related<super::merchants::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Merchant.def()
    }
}

impl Related<super::accounts::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Account.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
