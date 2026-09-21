use async_trait::async_trait;
pub use loco_rs::app::AppContext;
use loco_rs::{
    app::Hooks,
    bgworker::Queue,
    boot::{create_app, BootResult, StartMode},
    config::Config,
    controller::AppRoutes,
    environment::Environment,
    task::Tasks,
    Result,
};
use migration::Migrator;
use sea_orm::ConnectionTrait;
use std::path::Path;

use crate::{api, controllers, tasks};

pub struct App;

#[async_trait]
impl Hooks for App {
    fn app_name() -> &'static str {
        env!("CARGO_CRATE_NAME")
    }

    fn app_version() -> String {
        format!(
            "{} ({})",
            env!("CARGO_PKG_VERSION"),
            option_env!("BUILD_SHA")
                .or(option_env!("GITHUB_SHA"))
                .unwrap_or("dev")
        )
    }

    async fn boot(
        mode: StartMode,
        environment: &Environment,
        config: Config,
    ) -> Result<BootResult> {
        create_app::<Self, Migrator>(mode, environment, config).await
    }

    async fn before_run(ctx: &AppContext) -> Result<()> {
        enable_sqlite_pragmas(ctx).await;
        Ok(())
    }

    fn routes(_ctx: &AppContext) -> AppRoutes {
        AppRoutes::empty()
            .add_route(controllers::health::routes())
            .add_route(controllers::docs::routes())
            .add_route(controllers::auth::routes())
            .add_route(controllers::me::routes())
            .add_route(controllers::accounts::routes())
            .add_route(controllers::categories::routes())
            .add_route(controllers::merchants::routes())
            .add_route(controllers::transactions::routes())
            .add_route(controllers::recurring_rules::routes())
            .add_route(controllers::receipts::routes())
            .add_route(controllers::ai::routes())
            .add_route(controllers::dashboard::routes())
            .add_route(controllers::summaries::routes())
    }

    async fn after_routes(mut router: axum::Router, ctx: &AppContext) -> Result<axum::Router> {
        use axum::middleware;

        router = router.layer(middleware::from_fn_with_state(
            ctx.clone(),
            crate::middleware::rate_limit::handler,
        ));
        router = router.layer(middleware::from_fn(api::request_id::middleware));
        router = router.layer(crate::middleware::cors::layer());
        Ok(router)
    }

    async fn connect_workers(_ctx: &AppContext, _queue: &Queue) -> Result<()> {
        Ok(())
    }

    fn register_tasks(tasks: &mut Tasks) {
        tasks.register(tasks::maintenance::Maintenance);
    }

    async fn truncate(ctx: &AppContext) -> Result<()> {
        for table in [
            "idempotency_keys",
            "ai_import_logs",
            "recurring_occurrences",
            "recurring_rules",
            "transactions",
            "merchants",
            "categories",
            "accounts",
            "users",
        ] {
            ctx.db
                .execute_unprepared(&format!("DELETE FROM {table}"))
                .await?;
        }
        Ok(())
    }

    async fn seed(_ctx: &AppContext, _base: &Path) -> Result<()> {
        Ok(())
    }
}

async fn enable_sqlite_pragmas(ctx: &AppContext) {
    for pragma in [
        "PRAGMA journal_mode=WAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA foreign_keys=ON;",
    ] {
        if let Err(err) = ctx.db.execute_unprepared(pragma).await {
            tracing::warn!(error = %err, pragma, "failed to apply sqlite pragma");
        }
    }
}
