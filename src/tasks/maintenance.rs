use chrono::Duration;
use loco_rs::prelude::*;
use loco_rs::task::Vars;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

use crate::api::time;
use crate::models::_entities::idempotency_keys;

/// Daily cleanup of expired (older than 24h) idempotency keys.
/// Run via `cargo loco task maintenance:cleanup`.
pub struct Maintenance;

#[async_trait]
impl Task for Maintenance {
    fn task(&self) -> TaskInfo {
        TaskInfo {
            name: "maintenance:cleanup".to_string(),
            detail: "Delete IdempotencyKey rows older than 24 hours.".to_string(),
        }
    }

    async fn run(&self, app_context: &AppContext, _vars: &Vars) -> Result<()> {
        let cutoff = time::now_local() - Duration::hours(24);
        let result = idempotency_keys::Entity::delete_many()
            .filter(idempotency_keys::Column::CreatedAt.lt(cutoff))
            .exec(&app_context.db)
            .await
            .map_err(|err| Error::Message(err.to_string()))?;
        tracing::info!(deleted = result.rows_affected, "maintenance cleanup done");
        Ok(())
    }
}
