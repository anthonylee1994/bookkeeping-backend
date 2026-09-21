use axum::extract::FromRequestParts;
use axum::http::{header::AUTHORIZATION, request::Parts};

use crate::app::AppContext;
use crate::models::_entities::users;
use crate::models::users as users_model;
use crate::services::recurring;

use super::auth;
use super::error::ApiError;

/// Authenticated user extractor. Decodes the Bearer token, loads the user and
/// runs recurring catch-up before the handler executes.
pub struct AuthUser(pub users::Model);

impl AuthUser {
    pub fn id(&self) -> &str {
        &self.0.id
    }
}

impl FromRequestParts<AppContext> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppContext,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok());
        let token = auth::bearer_token(header).ok_or_else(ApiError::unauthorized)?;
        let user_id = auth::decode_token(&token).ok_or_else(ApiError::unauthorized)?;

        let user = users_model::find_by_id(&state.db, &user_id)
            .await
            .map_err(ApiError::from)?
            .ok_or_else(ApiError::unauthorized)?;

        recurring::catch_up(&state.db, &user.id).await;

        Ok(AuthUser(user))
    }
}
