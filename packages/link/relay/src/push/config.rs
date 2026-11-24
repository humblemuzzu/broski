use std::path::PathBuf;

use jsonwebtoken::EncodingKey;
use reqwest::Url;
use serde::Deserialize;

use crate::push::{parse_url, valid_token};

const APNS_ENDPOINT: &str = "https://api.push.apple.com";
const APNS_SANDBOX_ENDPOINT: &str = "https://api.sandbox.push.apple.com";
const FCM_ENDPOINT: &str = "https://fcm.googleapis.com";
const FCM_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";

#[derive(Clone, Default)]
pub struct PushConfig {
    pub apns: Option<ApnsConfig>,
    pub fcm: Option<FcmConfig>,
    pub upstream: Option<Url>,
}

#[derive(Clone)]
pub struct ApnsConfig {
    pub key: EncodingKey,
    pub key_id: String,
    pub team_id: String,
    pub topic: String,
    pub endpoint: Url,
}

#[derive(Clone)]
pub struct FcmConfig {
    pub key: EncodingKey,
    pub client_email: String,
    pub scope: &'static str,
    pub token_endpoint: Url,
    pub endpoint: Url,
}

#[derive(Default)]
pub struct PushArgs {
    pub apns: Option<ApnsArgs>,
    pub fcm_service_account: Option<PathBuf>,
    pub upstream: Option<String>,
    pub apns_endpoint: Option<String>,
    pub fcm_endpoint: Option<String>,
    pub fcm_token_endpoint: Option<String>,
}

pub struct ApnsArgs {
    pub key: PathBuf,
    pub key_id: String,
    pub team_id: String,
    pub topic: String,
    pub sandbox: bool,
}

#[derive(Deserialize)]
struct ServiceAccount {
    project_id: String,
    private_key: String,
    client_email: String,
    #[serde(default)]
    token_uri: Option<String>,
}

pub async fn load(args: PushArgs) -> Result<PushConfig, String> {
    let upstream = match args.upstream.as_deref() {
        Some(url) => {
            let parsed = parse_url(url).map_err(|error| format!("--push-upstream {error}"))?;
            let is_loopback =
                matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
            if parsed.scheme() != "https" && !is_loopback {
                return Err(
                    "--push-upstream must use https:// (http:// is allowed for loopback only)"
                        .to_owned(),
                );
            }
            Some(parsed)
        }
        None => None,
    };
    let apns = match args.apns {
        Some(apns) => Some(
            load_apns(apns, args.apns_endpoint.as_deref())
                .await
                .map_err(|error| format!("apns: {error}"))?,
        ),
        None => None,
    };
    let fcm = match args.fcm_service_account {
        Some(path) => Some(
            load_fcm(
                &path,
                args.fcm_endpoint.as_deref(),
                args.fcm_token_endpoint.as_deref(),
            )
            .await
            .map_err(|error| format!("fcm: {error}"))?,
        ),
        None => None,
    };
    Ok(PushConfig {
        apns,
        fcm,
        upstream,
    })
}

async fn load_apns(args: ApnsArgs, endpoint: Option<&str>) -> Result<ApnsConfig, String> {
    let fields = [
        ("--apns-key-id", args.key_id.as_str()),
        ("--apns-team-id", args.team_id.as_str()),
        ("--apns-topic", args.topic.as_str()),
    ];
    for (flag, value) in fields {
        if !valid_token(value) {
            return Err(format!("{flag} is empty or malformed"));
        }
    }
    let pem = read(&args.key, "--apns-key").await?;
    let key = EncodingKey::from_ec_pem(&pem)
        .map_err(|error| format!("--apns-key {}: {error}", args.key.display()))?;
    let endpoint = match endpoint {
        Some(url) => parse_url(url).map_err(|error| format!("--apns-endpoint {error}"))?,
        None if args.sandbox => parse_url(APNS_SANDBOX_ENDPOINT)?,
        None => parse_url(APNS_ENDPOINT)?,
    };
    Ok(ApnsConfig {
        key,
        key_id: args.key_id,
        team_id: args.team_id,
        topic: args.topic,
        endpoint,
    })
}

async fn load_fcm(
    path: &PathBuf,
    endpoint: Option<&str>,
    token_endpoint: Option<&str>,
) -> Result<FcmConfig, String> {
    let bytes = read(path, "--fcm-service-account").await?;
    let account: ServiceAccount = serde_json::from_slice(&bytes)
        .map_err(|error| format!("--fcm-service-account {}: {error}", path.display()))?;
    if account.project_id.trim().is_empty() || account.client_email.trim().is_empty() {
        return Err("service account is missing project_id or client_email".to_owned());
    }
    let key = EncodingKey::from_rsa_pem(account.private_key.as_bytes())
        .map_err(|error| format!("--fcm-service-account private_key: {error}"))?;
    let token_endpoint = match token_endpoint.or(account.token_uri.as_deref()) {
        Some(url) => parse_url(url).map_err(|error| format!("--fcm-token-endpoint {error}"))?,
        None => parse_url(FCM_TOKEN_ENDPOINT)?,
    };
    let mut base = match endpoint {
        Some(url) => parse_url(url).map_err(|error| format!("--fcm-endpoint {error}"))?,
        None => parse_url(FCM_ENDPOINT)?,
    };
    base.path_segments_mut()
        .map_err(|_| "--fcm-endpoint is not a base url".to_owned())?
        .extend([
            "v1",
            "projects",
            account.project_id.as_str(),
            "messages:send",
        ]);
    Ok(FcmConfig {
        key,
        client_email: account.client_email,
        scope: FCM_SCOPE,
        token_endpoint,
        endpoint: base,
    })
}

async fn read(path: &PathBuf, flag: &str) -> Result<Vec<u8>, String> {
    tokio::fs::read(path)
        .await
        .map_err(|error| format!("{flag} {}: {error}", path.display()))
}
