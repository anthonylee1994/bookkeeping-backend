use chrono::Duration;
use loco_rs::task::{Task, Vars};
use loco_rs::testing::prelude::*;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serial_test::serial;

use bookkeeping_backend::api::time;
use bookkeeping_backend::app::App;
use bookkeeping_backend::models::_entities::idempotency_keys;
use bookkeeping_backend::tasks::maintenance::Maintenance;

use super::prepare_data::{create_idempotency_key, register_and_login};

#[tokio::test]
#[serial]
async fn up_returns_ok() {
    request::<App, _, _>(|request, _ctx| async move {
        assert_eq!(request.get("/up").await.status_code(), 200);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn api_docs_serves_the_openapi_definition() {
    request::<App, _, _>(|request, _ctx| async move {
        let response = request.get("/api-docs").await;
        assert_eq!(response.status_code(), 200);
        assert_eq!(response.content_type(), "application/yaml");
        assert!(response.text().contains("Bookkeeping API"));
    })
    .await;
}

#[tokio::test]
#[serial]
async fn maintenance_cleanup_removes_expired_idempotency_keys() {
    request::<App, _, _>(|request, ctx| async move {
        let fixture = register_and_login(&request, &ctx).await;
        let now = time::now_local();
        create_idempotency_key(&ctx.db, &fixture.user_id, "old", now - Duration::hours(25)).await;
        create_idempotency_key(
            &ctx.db,
            &fixture.user_id,
            "recent",
            now - Duration::hours(1),
        )
        .await;

        Maintenance.run(&ctx, &Vars::default()).await.unwrap();

        let remaining = idempotency_keys::Entity::find()
            .filter(idempotency_keys::Column::UserId.eq(&fixture.user_id))
            .all(&ctx.db)
            .await
            .unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].key, "recent");
    })
    .await;
}
