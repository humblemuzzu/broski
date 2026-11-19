use std::sync::Mutex;
use std::time::Instant;

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::limits::{APNS_JWT_REFRESH, PROVIDER_BODY_BYTES};
use crate::push::config::ApnsConfig;
use crate::push::{bounded_body, client_builder, Platform, PushError, PushRequest};

const PUSH_TYPE: HeaderName = HeaderName::from_static("apns-push-type");
const TOPIC: HeaderName = HeaderName::from_static("apns-topic");
const PRIORITY: HeaderName = HeaderName::from_static("apns-priority");
const COLLAPSE: HeaderName = HeaderName::from_static("apns-collapse-id");

pub struct ApnsClient {
    http: reqwest::Client,
    endpoint: reqwest::Url,
    topic: HeaderValue,
    liveactivity_topic: HeaderValue,
    key_id: String,
    team_id: String,
    key: EncodingKey,
    jwt: Mutex<Option<Cached>>,
}

struct Cached {
    token: String,
    at: Instant,
}

#[derive(Serialize)]
struct Claims<'a> {
    iss: &'a str,
    iat: u64,
}

#[derive(Serialize)]
struct Notification<'a> {
    aps: Aps<'a>,
    m: &'a str,
    k: &'a str,
    e: String,
}

#[derive(Serialize)]
struct Aps<'a> {
    alert: Alert,
    #[serde(rename = "mutable-content")]
    mutable: u8,
    category: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    sound: Option<&'static str>,
}

#[derive(Serialize)]
struct Alert {
    title: &'static str,
    body: &'static str,
}

#[derive(Deserialize)]
struct Reason {
    reason: String,
}

impl ApnsClient {
    pub fn new(config: &ApnsConfig) -> Result<ApnsClient, String> {
        let mut builder = client_builder().pool_max_idle_per_host(4);
        if config.endpoint.scheme() == "http" {
            builder = builder.http2_prior_knowledge();
        }
        let http = builder.build().map_err(|error| error.to_string())?;
        let topic = HeaderValue::from_str(&config.topic).map_err(|error| error.to_string())?;
        let liveactivity_topic =
            HeaderValue::from_str(&format!("{}.push-type.liveactivity", config.topic))
                .map_err(|error| error.to_string())?;
        Ok(ApnsClient {
            http,
            endpoint: config.endpoint.clone(),
            topic,
            liveactivity_topic,
            key_id: config.key_id.clone(),
            team_id: config.team_id.clone(),
            key: config.key.clone(),
            jwt: Mutex::new(None),
        })
    }

    pub async fn send(&self, request: &PushRequest) -> Result<(), PushError> {
        let bearer = self.bearer()?;
        let mut url = self.endpoint.clone();
        url.path_segments_mut()
            .map_err(|_| PushError::BadRequest)?
            .extend(["3", "device", request.token.as_str()]);
        let live_activity = request.platform == Platform::ApnsLiveActivity;
        let mut headers = HeaderMap::new();
        headers.insert(
            PUSH_TYPE,
            HeaderValue::from_static(if live_activity {
                "liveactivity"
            } else {
                "alert"
            }),
        );
        headers.insert(
            TOPIC,
            if live_activity {
                self.liveactivity_topic.clone()
            } else {
                self.topic.clone()
            },
        );
        headers.insert(PRIORITY, HeaderValue::from_static(request.priority.apns()));
        if let Some(collapse) = &request.collapse {
            headers.insert(
                COLLAPSE,
                HeaderValue::from_str(collapse).map_err(|_| PushError::BadRequest)?,
            );
        }
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("bearer {bearer}")).map_err(|_| PushError::Failed)?,
        );
        let body = if live_activity {
            request.data.clone()
        } else {
            serde_json::to_vec(&Notification {
                aps: Aps {
                    alert: Alert {
                        title: "Broski",
                        body: "New activity",
                    },
                    mutable: 1,
                    category: request.kind.as_str(),
                    sound: request.kind.wants_sound().then_some("default"),
                },
                m: &request.machine,
                k: request.kind.as_str(),
                e: crate::auth::b64url_encode(&request.data),
            })
            .map_err(|_| PushError::Failed)?
        };
        let response = self
            .http
            .post(url)
            .headers(headers)
            .header(CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await
            .map_err(|_| PushError::Failed)?;
        classify(response).await
    }

    fn bearer(&self) -> Result<String, PushError> {
        let mut cached = self.jwt.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cached) = cached.as_ref() {
            if cached.at.elapsed() < APNS_JWT_REFRESH {
                return Ok(cached.token.clone());
            }
        }
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some(self.key_id.clone());
        let claims = Claims {
            iss: &self.team_id,
            iat: jsonwebtoken::get_current_timestamp(),
        };
        let token = encode(&header, &claims, &self.key).map_err(|error| {
            warn!(error = %error, "apns assertion failed");
            PushError::Failed
        })?;
        *cached = Some(Cached {
            token: token.clone(),
            at: Instant::now(),
        });
        Ok(token)
    }
}

async fn classify(response: reqwest::Response) -> Result<(), PushError> {
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = bounded_body(response, PROVIDER_BODY_BYTES).await;
    let reason = serde_json::from_slice::<Reason>(&body)
        .map(|reason| reason.reason)
        .unwrap_or_default();
    if status.as_u16() == 410
        || matches!(
            reason.as_str(),
            "BadDeviceToken" | "DeviceTokenNotForTopic" | "Unregistered"
        )
    {
        return Err(PushError::TokenInvalid);
    }
    if status.as_u16() == 429 || status.is_server_error() {
        return Err(PushError::Failed);
    }
    Err(PushError::Rejected)
}
