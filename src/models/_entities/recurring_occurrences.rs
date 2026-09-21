use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "recurring_occurrences")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub recurring_rule_id: String,
    pub occurred_on: Date,
    pub transaction_id: Option<String>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::recurring_rules::Entity",
        from = "Column::RecurringRuleId",
        to = "super::recurring_rules::Column::Id"
    )]
    RecurringRule,
    #[sea_orm(
        belongs_to = "super::transactions::Entity",
        from = "Column::TransactionId",
        to = "super::transactions::Column::Id"
    )]
    Transaction,
}

impl Related<super::recurring_rules::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RecurringRule.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
