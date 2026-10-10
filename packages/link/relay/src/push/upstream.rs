use reqwest::header::CONTENT_TYPE;
use serde::Serialize;

use crate::limits::PROVIDER_BODY_BYTES;
use crate::push::{bounded_body, client_builder, PushError, PushRequest};

pub struct UpstreamClient {
    http: reqwest::Client,
    url: reqwest::Url,
}

#[derive(Serialize)]
struct Forwarded<'a> {
    platform: &'static str,
    token: &'a str,
    kind: &'static str,
    data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    collapse: Option<&'a str>,
    priority: &'static str,
    machine: &'a str,
}

impl UpstreamClient {
    pub fn new(url: &reqwest::Url) -> Result<UpstreamClient, String> {
        let http = client_builder()
            .pool_max_idle_per_host(4)
            .build()
            .map_err(|error| error.to_string())?;
        Ok(UpstreamClient {
            http,
            url: url.clone(),
        })
    }

    pub async fn send(&self, request: &PushRequest) -> Result<(), PushError> {
        let body = serde_json::to_vec(&Forwarded {
            platform: request.platform.as_str(),
            token: &request.token,
            kind: request.kind.as_str(),
            data: crate::auth::b64url_encode(&request.data),
            collapse: request.collapse.as_deref(),
            priority: request.priority.as_str(),
            machine: &request.machine,
        })
        .map_err(|_| PushError::Failed)?;
        let response = self
            .http
            .post(self.url.clone())
            .header(CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await
            .map_err(|_| PushError::Failed)?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let code = status.as_u16();
        let _ = bounded_body(response, PROVIDER_BODY_BYTES).await;
        match code {
            400 => Err(PushError::BadRequest),
            404 => Err(PushError::Unconfigured),
            429 => Err(PushError::RateLimited),
            code if code >= 500 => Err(PushError::Failed),
            _ => Err(PushError::Rejected),
        }
    }
}
