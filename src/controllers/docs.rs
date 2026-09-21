use axum::{
    http::header::CONTENT_TYPE,
    response::{IntoResponse, Response},
};
use loco_rs::controller::Routes;

pub fn routes() -> Routes {
    Routes::new().add("/api-docs", axum::routing::get(spec))
}

async fn spec() -> Response {
    (
        [(CONTENT_TYPE, "application/yaml")],
        include_str!("../../swagger/v1/swagger.yaml"),
    )
        .into_response()
}
