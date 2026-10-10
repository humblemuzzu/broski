use std::sync::Mutex;
use std::time::{Duration, Instant};

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::limits::{FCM_TOKEN_MARGIN, PROVIDER_BODY_BYTES};
use crate::push::config::FcmConfig;
use crate::push::{bounded_body, client_builder, PushError, PushRequest};

const GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const ASSERTION_LIFETIME: u64 = 3600;

pub struct FcmClient {
    http: reqwest::Client,
    endpoint: reqwest::Url,
    token_endpoint: reqwest::Url,
    client_email: String,
    scope: &'static str,
    key: EncodingKey,
    access: Mutex<Option<Cached>>,
}

struct Cached {
    token: String,
    expires: Instant,
}

#[derive(Serialize)]
struct Claims<'a> {
    iss: &'a str,
    scope: &'static str,
    aud: &'a str,
    iat: u64,
    exp: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
}

#[derive(Serialize)]
struct Envelope<'a> {
    message: Message<'a>,
}

#[derive(Serialize)]
struct Message<'a> {
    token: &'a str,
    data: Data<'a>,
    android: Android<'a>,
}

#[derive(Serialize)]
struct Data<'a> {
    m: &'a str,
    k: &'a str,
    e: String,
}

#[derive(Serialize)]
struct Android<'a> {
    priority: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    collapse_key: Option<&'a str>,
}

impl FcmClient {
    pub fn new(config: &FcmConfig) -> Result<FcmClient, String> {
        let http = client_builder()
            .pool_max_idle_per_host(4)
            .build()
            .map_err(|error| error.to_string())?;
        Ok(FcmClient {
            http,
            endpoint: config.endpoint.clone(),
            token_endpoint: config.token_endpoint.clone(),
            client_email: config.client_email.clone(),
            scope: config.scope,
            key: config.key.clone(),
            access: Mutex::new(None),
        })
    }

    pub async fn send(&self, request: &PushRequest) -> Result<(), PushError> {
        let access = self.access_token().await?;
        let body = serde_json::to_vec(&Envelope {
            message: Message {
                token: &request.token,
                data: Data {
                    m: &request.machine,
                    k: request.kind.as_str(),
                    e: crate::auth::b64url_encode(&request.data),
                },
                android: Android {
                    priority: request.priority.fcm(),
                    collapse_key: request.collapse.as_deref(),
                },
            },
        })
        .map_err(|_| PushError::Failed)?;
        let response = self
            .http
            .post(self.endpoint.clone())
            .bearer_auth(access)
            .body(body)
            .send()
            .await
            .map_err(|_| PushError::Failed)?;
        classify(response).await
    }

    async fn access_token(&self) -> Result<String, PushError> {
        if let Some(token) = self.cached() {
            return Ok(token);
        }
        let now = jsonwebtoken::get_current_timestamp();
        let claims = Claims {
            iss: &self.client_email,
            scope: self.scope,
            aud: self.token_endpoint.as_str(),
            iat: now,
            exp: now + ASSERTION_LIFETIME,
        };
        let assertion =
            encode(&Header::new(Algorithm::RS256), &claims, &self.key).map_err(|error| {
                warn!(error = %error, "fcm assertion failed");
                PushError::Failed
            })?;
        let response = self
            .http
            .post(self.token_endpoint.clone())
            .form(&[("grant_type", GRANT_TYPE), ("assertion", &assertion)])
            .send()
            .await
            .map_err(|_| PushError::Failed)?;
        let status = response.status();
        let body = bounded_body(response, PROVIDER_BODY_BYTES).await;
        if !status.is_success() {
            warn!(status = status.as_u16(), "fcm token exchange rejected");
            return Err(PushError::Failed);
        }
        let token: TokenResponse = serde_json::from_slice(&body).map_err(|_| PushError::Failed)?;
        let lifetime = Duration::from_secs(token.expires_in.unwrap_or(ASSERTION_LIFETIME));
        if lifetime > FCM_TOKEN_MARGIN {
            let mut cached = self.access.lock().unwrap_or_else(|e| e.into_inner());
            *cached = Some(Cached {
                token: token.access_token.clone(),
                expires: Instant::now() + (lifetime - FCM_TOKEN_MARGIN),
            });
        }
        Ok(token.access_token)
    }

    fn cached(&self) -> Option<String> {
        let cached = self.access.lock().unwrap_or_else(|e| e.into_inner());
        let cached = cached.as_ref()?;
        (Instant::now() < cached.expires).then(|| cached.token.clone())
    }
}

async fn classify(response: reqwest::Response) -> Result<(), PushError> {
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let code = status.as_u16();
    let body = bounded_body(response, PROVIDER_BODY_BYTES).await;
    let text = String::from_utf8_lossy(&body);
    let unregistered = text.contains("UNREGISTERED") || text.contains("INVALID_ARGUMENT");
    if unregistered && (code == 400 || code == 404) {
        return Err(PushError::TokenInvalid);
    }
    if code == 400 || code == 404 {
        return Err(PushError::Rejected);
    }
    Err(PushError::Failed)
}
