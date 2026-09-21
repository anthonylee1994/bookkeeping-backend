use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use loco_rs::controller::Routes;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::api::{error::ApiError, ApiResult, AuthUser};
use crate::app::AppContext;
use crate::services::lihkg::{self, LihkgError, UploadFile};

pub fn routes() -> Routes {
    Routes::new()
        .prefix("/api/v1")
        .add("/receipts/upload", axum::routing::post(upload))
}

async fn upload(
    _user: AuthUser,
    State(_ctx): State<AppContext>,
    mut multipart: Multipart,
) -> ApiResult<Response> {
    let mut file: Option<UploadFile> = None;

    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                if field.name() != Some("file") {
                    continue;
                }
                let filename = field
                    .file_name()
                    .map(ToString::to_string)
                    .unwrap_or_else(|| "upload".to_string());
                let bytes = field.bytes().await.map_err(|err| {
                    ApiError::new(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "validation_error",
                        err.to_string(),
                    )
                })?;
                file = Some(UploadFile {
                    bytes: bytes.to_vec(),
                    filename,
                });
            }
            Ok(None) => break,
            Err(err) => {
                return Err(ApiError::new(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "validation_error",
                    err.to_string(),
                ));
            }
        }
    }

    let Some(file) = file else {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation_error",
            "file is required",
        ));
    };

    let mut hasher = Sha256::new();
    hasher.update(&file.bytes);
    let sha = hex::encode(hasher.finalize());

    match lihkg::upload(file).await {
        Ok(url) => Ok((
            StatusCode::CREATED,
            Json(json!({ "data": { "url": url, "sha256": sha } })),
        )
            .into_response()),
        Err(LihkgError::InvalidFile(message)) => Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation_error",
            message,
        )),
        Err(err) => {
            tracing::error!(
                event = "lihkg_upload_failed",
                error = %err,
                "lihkg upload failed"
            );
            Err(ApiError::upstream_error(err.to_string()))
        }
    }
}
