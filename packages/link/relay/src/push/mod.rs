mod apns;
pub mod config;
pub mod endpoint;
mod fcm;
mod message;
mod upstream;

use std::net::IpAddr;
use std::sync::Arc;

use reqwest::Url;
use tokio::sync::Semaphore;
use tracing::{info, warn};

use crate::auth::truncated;
use crate::limiter::Limiter;
use crate::limits::{
    MAX_PUSH_TOKEN_CHARS, PROVIDER_CONCURRENCY, PROVIDER_TIMEOUT, PUSH_IP_RATE, PUSH_MACHINE_RATE,
    PUSH_TOKEN_RATE,
};

pub use config::PushConfig;
pub use message::{from_machine, from_public, PublicPush};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Platform {
    Apns,
    Fcm,
}

impl Platform {
    pub fn parse(text: &str) -> Option<Platform> {
        match text {
            "apns" => Some(Platform::Apns),
            "fcm" => Some(Platform::Fcm),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Platform::Apns => "apns",
            Platform::Fcm => "fcm",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Approval,
    Done,
    Attention,
    Generic,
    Offline,
}

impl Kind {
    pub fn parse(text: &str) -> Option<Kind> {
        match text {
            "approval" => Some(Kind::Approval),
            "done" => Some(Kind::Done),
            "attention" => Some(Kind::Attention),
            "generic" => Some(Kind::Generic),
            "offline" => Some(Kind::Offline),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Approval => "approval",
            Kind::Done => "done",
            Kind::Attention => "attention",
            Kind::Generic => "generic",
            Kind::Offline => "offline",
        }
    }

    fn wants_sound(self) -> bool {
        matches!(self, Kind::Approval | Kind::Attention)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Priority {
    High,
    Normal,
}

impl Priority {
    pub fn parse(text: &str) -> Option<Priority> {
        match text {
            "high" => Some(Priority::High),
            "normal" => Some(Priority::Normal),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Priority::High => "high",
            Priority::Normal => "normal",
        }
    }

    fn apns(self) -> &'static str {
        match self {
            Priority::High => "10",
            Priority::Normal => "5",
        }
    }

    fn fcm(self) -> &'static str {
        match self {
            Priority::High => "HIGH",
            Priority::Normal => "NORMAL",
        }
    }
}

#[derive(Clone, Debug)]
pub struct PushRequest {
    pub machine: String,
    pub platform: Platform,
    pub token: String,
    pub kind: Kind,
    pub data: Vec<u8>,
    pub collapse: Option<String>,
    pub priority: Priority,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PushError {
    Unconfigured,
    BadRequest,
    TokenInvalid,
    Rejected,
    Failed,
    RateLimited,
}

impl PushError {
    pub fn code(self) -> &'static str {
        match self {
            PushError::Unconfigured => "push_unconfigured",
            PushError::BadRequest => "bad_request",
            PushError::TokenInvalid => "push_token_invalid",
            PushError::Rejected => "push_rejected",
            PushError::Failed => "push_failed",
            PushError::RateLimited => "rate_limited",
        }
    }
}

pub struct PushSender {
    apns: Option<apns::ApnsClient>,
    fcm: Option<fcm::FcmClient>,
    upstream: Option<upstream::UpstreamClient>,
    permits: Arc<Semaphore>,
    machines: Limiter<String>,
    tokens: Limiter<String>,
    ips: Limiter<IpAddr>,
}

impl PushSender {
    pub fn new(config: PushConfig) -> PushSender {
        let apns = config
            .apns
            .as_ref()
            .and_then(|apns| or_disabled(apns::ApnsClient::new(apns), "apns"));
        let fcm = config
            .fcm
            .as_ref()
            .and_then(|fcm| or_disabled(fcm::FcmClient::new(fcm), "fcm"));
        let upstream = config
            .upstream
            .as_ref()
            .and_then(|url| or_disabled(upstream::UpstreamClient::new(url), "push upstream"));
        PushSender {
            apns,
            fcm,
            upstream,
            permits: Arc::new(Semaphore::new(PROVIDER_CONCURRENCY)),
            machines: Limiter::new(PUSH_MACHINE_RATE),
            tokens: Limiter::new(PUSH_TOKEN_RATE),
            ips: Limiter::new(PUSH_IP_RATE),
        }
    }

    pub fn has_providers(&self) -> bool {
        self.apns.is_some() || self.fcm.is_some()
    }

    pub fn configured(&self) -> bool {
        self.has_providers() || self.upstream.is_some()
    }

    pub fn allow_machine(&self, machine: &str) -> bool {
        self.machines.allow(machine.to_owned())
    }

    pub fn allow_token(&self, token: &str) -> bool {
        self.tokens.allow(token.to_owned())
    }

    pub fn allow_ip(&self, ip: IpAddr) -> bool {
        self.ips.allow(ip)
    }

    pub async fn send(&self, request: &PushRequest) -> Result<(), PushError> {
        let permit = self
            .permits
            .clone()
            .try_acquire_owned()
            .map_err(|_| PushError::RateLimited)?;
        let outcome = self.dispatch(request).await;
        match outcome {
            Ok(()) => info!(
                machine = truncated(&request.machine),
                kind = request.kind.as_str(),
                "push accepted"
            ),
            Err(error) => warn!(
                machine = truncated(&request.machine),
                kind = request.kind.as_str(),
                code = error.code(),
                "push failed"
            ),
        }
        drop(permit);
        outcome
    }

    async fn dispatch(&self, request: &PushRequest) -> Result<(), PushError> {
        match request.platform {
            Platform::Apns => {
                if let Some(client) = &self.apns {
                    return client.send(request).await;
                }
            }
            Platform::Fcm => {
                if let Some(client) = &self.fcm {
                    return client.send(request).await;
                }
            }
        }
        match &self.upstream {
            Some(client) => client.send(request).await,
            None => Err(PushError::Unconfigured),
        }
    }
}

fn or_disabled<T>(client: Result<T, String>, name: &str) -> Option<T> {
    match client {
        Ok(client) => Some(client),
        Err(error) => {
            warn!(provider = name, error = %error, "push provider disabled");
            None
        }
    }
}

pub(crate) fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().timeout(PROVIDER_TIMEOUT)
}

pub(crate) async fn bounded_body(mut response: reqwest::Response, limit: usize) -> Vec<u8> {
    let mut body = Vec::new();
    while body.len() < limit {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let room = limit - body.len();
                body.extend_from_slice(&chunk[..chunk.len().min(room)]);
            }
            _ => break,
        }
    }
    body
}

pub(crate) fn parse_url(text: &str) -> Result<Url, String> {
    Url::parse(text).map_err(|error| format!("{text}: {error}"))
}

pub(crate) fn valid_token(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_PUSH_TOKEN_CHARS
        && text.bytes().all(|byte| byte.is_ascii_graphic())
}
