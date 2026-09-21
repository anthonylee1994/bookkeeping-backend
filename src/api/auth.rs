use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

const TOKEN_ALGORITHM: Algorithm = Algorithm::HS256;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub user_id: String,
    pub iat: i64,
}

pub fn jwt_secret() -> String {
    std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-jwt-secret".to_string())
}

/// Tokens carry `user_id` + `iat` and deliberately no `exp`, matching the
/// spec: every environment ignores expiration and logout is client-side only.
pub fn encode_token(user_id: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let claims = Claims {
        user_id: user_id.to_string(),
        iat: chrono::Utc::now().timestamp(),
    };
    encode(
        &Header::new(TOKEN_ALGORITHM),
        &claims,
        &EncodingKey::from_secret(jwt_secret().as_bytes()),
    )
}

pub fn decode_token(token: &str) -> Option<String> {
    let mut validation = Validation::new(TOKEN_ALGORITHM);
    validation.validate_exp = false;
    validation.required_spec_claims.clear();
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(jwt_secret().as_bytes()),
        &validation,
    )
    .ok()
    .map(|data| data.claims.user_id)
}

/// Best-effort decode without signature verification, used only for rate-limit
/// discrimination (mirrors Rack::Attack's `JWT.decode(token, nil, false)`).
pub fn decode_token_unsafe(token: &str) -> Option<String> {
    let mut validation = Validation::new(TOKEN_ALGORITHM);
    validation.insecure_disable_signature_validation();
    validation.validate_exp = false;
    validation.required_spec_claims.clear();
    decode::<Claims>(token, &DecodingKey::from_secret(b""), &validation)
        .ok()
        .map(|data| data.claims.user_id)
}

pub fn hash_password(password: &str) -> Result<String, bcrypt::BcryptError> {
    bcrypt::hash(password, bcrypt::DEFAULT_COST)
}

/// Verifies against a bcrypt digest. Existing Rails `has_secure_password`
/// hashes are `$2a$`/`$2b$` and verify with the `bcrypt` crate.
pub fn verify_password(password: &str, digest: &str) -> bool {
    bcrypt::verify(password, digest).unwrap_or(false)
}

pub fn bearer_token(header: Option<&str>) -> Option<String> {
    let header = header?.trim();
    let (scheme, token) = header.split_once(' ')?;
    if scheme.eq_ignore_ascii_case("Bearer") {
        let token = token.trim();
        if token.is_empty() {
            None
        } else {
            Some(token.to_string())
        }
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
    use serde_json::json;

    fn raw_secret() -> String {
        jwt_secret()
    }

    fn decode_value(token: &str, secret: &str) -> Option<serde_json::Value> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.validate_exp = false;
        validation.required_spec_claims.clear();
        decode::<serde_json::Value>(
            token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &validation,
        )
        .ok()
        .map(|data| data.claims)
    }

    #[test]
    fn encode_uses_hs256_and_omits_exp_and_jti() {
        let token = encode_token("user-1").unwrap();
        assert_eq!(
            jsonwebtoken::decode_header(&token).unwrap().alg,
            Algorithm::HS256
        );

        let payload = decode_value(&token, &raw_secret()).expect("payload");
        assert_eq!(payload["user_id"], "user-1");
        assert!(payload["iat"].is_i64());
        assert!(payload.get("exp").is_none());
        assert!(payload.get("jti").is_none());
    }

    #[test]
    fn decode_returns_user_id_for_valid_token() {
        let token = encode_token("user-2").unwrap();
        assert_eq!(decode_token(&token).as_deref(), Some("user-2"));
    }

    #[test]
    fn decode_rejects_token_signed_with_another_secret() {
        let token = encode(
            &Header::new(Algorithm::HS256),
            &json!({ "user_id": "user-3", "iat": 1_700_000_000i64 }),
            &EncodingKey::from_secret(b"other-secret"),
        )
        .unwrap();
        assert!(decode_token(&token).is_none());
    }

    #[test]
    fn decode_rejects_malformed_token() {
        assert!(decode_token("not-a-jwt").is_none());
    }

    #[test]
    fn decode_rejects_alg_none_token() {
        let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let header = engine.encode(br#"{"alg":"none","typ":"JWT"}"#);
        let payload = engine.encode(br#"{"user_id":"user-4"}"#);
        let token = format!("{header}.{payload}.");
        assert!(decode_token(&token).is_none());
    }

    #[test]
    fn decode_accepts_expired_exp() {
        let token = encode(
            &Header::new(Algorithm::HS256),
            &json!({ "user_id": "user-5", "iat": 1i64, "exp": 1i64 }),
            &EncodingKey::from_secret(raw_secret().as_bytes()),
        )
        .unwrap();
        assert_eq!(decode_token(&token).as_deref(), Some("user-5"));
    }

    #[test]
    fn decode_token_unsafe_reads_claims_without_signature() {
        let token = encode(
            &Header::new(Algorithm::HS256),
            &json!({ "user_id": "user-6", "iat": 1i64 }),
            &EncodingKey::from_secret(b"other-secret"),
        )
        .unwrap();
        assert_eq!(decode_token_unsafe(&token).as_deref(), Some("user-6"));
    }
}
