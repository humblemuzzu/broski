use std::collections::HashMap;

use broski_relay::auth::b64url_encode;
use broski_relay::limits::{Limits, RateLimit};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde_json::{json, Value};

use super::keys::{TEST_APNS_PUBLIC_PEM, TEST_FCM_PUBLIC_PEM};
use super::{providers, Client, Providers, Relay, APNS_KEY_ID, FCM_CLIENT_EMAIL};

pub const APNS_TOKEN: &str = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
pub const FCM_TOKEN: &str = "fcm-token-1:APA91bExample";
pub const DATA: &[u8] = b"opaque-ciphertext";

pub async fn relay_with_push() -> (Relay, Providers) {
    let providers = providers().await;
    let relay = Relay::start_configured(
        RateLimit::default(),
        Limits::default(),
        providers.config.clone(),
    )
    .await;
    (relay, providers)
}

pub async fn connect(relay: &Relay, seed: u8) -> (Client, String) {
    relay.registered(seed).await
}

pub fn push_body(
    platform: &str,
    token: &str,
    kind: &str,
    data: &[u8],
    collapse: Option<&str>,
    priority: Option<&str>,
) -> Value {
    let mut body = json!({
        "t": "push",
        "platform": platform,
        "token": token,
        "kind": kind,
        "data": b64url_encode(data),
    });
    if let Some(collapse) = collapse {
        body["collapse"] = json!(collapse);
    }
    if let Some(priority) = priority {
        body["priority"] = json!(priority);
    }
    body
}

pub async fn push(
    machine: &mut Client,
    platform: &str,
    token: &str,
    kind: &str,
    data: &[u8],
    collapse: Option<&str>,
    priority: Option<&str>,
) -> Value {
    machine
        .request(push_body(platform, token, kind, data, collapse, priority))
        .await
}

pub fn apns_header(token: &str) -> jsonwebtoken::Header {
    decode_header(token).expect("apns assertion header")
}

pub fn apns_claims(token: &str) -> Value {
    let mut validation = Validation::new(Algorithm::ES256);
    validation.required_spec_claims.clear();
    validation.validate_exp = false;
    validation.validate_aud = false;
    let key = DecodingKey::from_ec_pem(TEST_APNS_PUBLIC_PEM.as_bytes()).expect("apns public key");
    let claims = decode::<Value>(token, &key, &validation)
        .expect("apns assertion verifies")
        .claims;
    assert_eq!(apns_header(token).kid.as_deref(), Some(APNS_KEY_ID));
    claims
}

pub fn form(body: &[u8]) -> HashMap<String, String> {
    let url = reqwest::Url::parse(&format!("http://mock/?{}", String::from_utf8_lossy(body)))
        .expect("form body");
    url.query_pairs().into_owned().collect()
}

pub fn fcm_assertion_claims(body: &[u8], token_endpoint: &str) -> Value {
    let fields = form(body);
    assert_eq!(
        fields.get("grant_type").map(String::as_str),
        Some("urn:ietf:params:oauth:grant-type:jwt-bearer")
    );
    let assertion = fields.get("assertion").expect("assertion");
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[token_endpoint]);
    validation.set_issuer(&[FCM_CLIENT_EMAIL]);
    let key = DecodingKey::from_rsa_pem(TEST_FCM_PUBLIC_PEM.as_bytes()).expect("fcm public key");
    decode::<Value>(assertion, &key, &validation)
        .expect("fcm assertion verifies")
        .claims
}
