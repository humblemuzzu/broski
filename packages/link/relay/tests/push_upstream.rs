mod common;

use broski_relay::auth::b64url_encode;
use broski_relay::limits::{Limits, RateLimit};
use common::{http_post, providers, upstream_push_config, Relay, APNS_TOPIC};
use serde_json::{json, Value};

const APNS_TOKEN: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddee";
const DATA: &[u8] = b"upstream-ciphertext";

async fn keyless(upstream: &str) -> Relay {
    Relay::start_configured(
        RateLimit::default(),
        Limits::default(),
        upstream_push_config(upstream).await,
    )
    .await
}

async fn public_push(relay: &Relay, body: &Value) -> (u16, String) {
    http_post(
        relay.addr,
        "/v1/push",
        &[("content-type", "application/json")],
        body.to_string().as_bytes(),
    )
    .await
}

fn forwarded_body() -> Value {
    json!({
        "platform": "apns",
        "token": APNS_TOKEN,
        "kind": "generic",
        "data": b64url_encode(DATA),
        "priority": "normal",
    })
}

#[tokio::test]
async fn machine_pushes_are_forwarded_from_a_keyless_relay_to_a_keyed_relay() {
    let providers = providers().await;
    let keyed = Relay::start_configured(
        RateLimit::default(),
        Limits::default(),
        providers.config.clone(),
    )
    .await;
    let keyless = keyless(&format!("http://{}/v1/push", keyed.addr)).await;
    assert_eq!(
        public_push(&keyless, &forwarded_body()).await.0,
        404,
        "the keyless relay serves no public push endpoint"
    );

    let (mut machine, id) = keyless.registered(91).await;
    let reply = machine
        .request(json!({
            "t": "push",
            "platform": "apns",
            "token": APNS_TOKEN,
            "kind": "attention",
            "data": b64url_encode(DATA),
            "collapse": "through-two-relays",
            "priority": "high",
        }))
        .await;
    assert_eq!(reply["t"], "ok", "{reply}");

    let requests = providers.apns.requests.all();
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    assert_eq!(request.path, format!("/3/device/{APNS_TOKEN}"));
    assert_eq!(request.header("apns-topic"), APNS_TOPIC);
    assert_eq!(request.header("apns-priority"), "10");
    assert_eq!(request.header("apns-collapse-id"), "through-two-relays");
    let body = request.json();
    assert_eq!(body["e"], b64url_encode(DATA));
    assert_eq!(body["k"], "attention");
    assert_eq!(body["m"], id);
}

#[tokio::test]
async fn the_public_endpoint_sends_directly_on_a_keyed_relay() {
    let providers = providers().await;
    let keyed = Relay::start_configured(
        RateLimit::default(),
        Limits::default(),
        providers.config.clone(),
    )
    .await;

    let (status, body) = public_push(&keyed, &forwarded_body()).await;
    assert_eq!(status, 200, "{body}");
    let value: Value = serde_json::from_str(&body).expect("push reply");
    assert_eq!(value["ok"], true);

    let requests = providers.apns.requests.all();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].json()["m"], "", "no machine was named");

    let (status, body) = public_push(
        &keyed,
        &json!({"platform": "sms", "token": APNS_TOKEN, "kind": "generic", "data": "AA"}),
    )
    .await;
    assert_eq!(status, 400, "{body}");
    assert!(body.contains("bad_request"), "{body}");

    let (status, _) = http_post(keyed.addr, "/v1/push", &[], b"{not json").await;
    assert_eq!(status, 400);

    let mut huge = forwarded_body();
    huge["collapse"] = json!("x".repeat(1024));
    let (status, _) = public_push(&keyed, &huge).await;
    assert_eq!(status, 400);

    let oversized = format!(
        "{{\"platform\":\"apns\",\"token\":\"{APNS_TOKEN}\",\"kind\":\"generic\",\"data\":\"{}\"}}",
        "A".repeat(20 * 1024)
    );
    let (status, _) = http_post(
        keyed.addr,
        "/v1/push",
        &[("content-type", "application/json")],
        oversized.as_bytes(),
    )
    .await;
    assert_eq!(status, 413);
}

#[tokio::test]
async fn the_public_endpoint_is_limited_per_push_token() {
    let providers = providers().await;
    let keyed = Relay::start_configured(
        RateLimit::default(),
        Limits::default(),
        providers.config.clone(),
    )
    .await;

    for index in 0..30u32 {
        let (status, body) = public_push(&keyed, &forwarded_body()).await;
        assert_eq!(status, 200, "push {index}: {body}");
    }
    let (status, body) = public_push(&keyed, &forwarded_body()).await;
    assert_eq!(status, 429, "{body}");
    assert!(body.contains("rate_limited"), "{body}");
    assert_eq!(providers.apns.requests.count(), 30);

    let mut other = forwarded_body();
    other["token"] = json!("another-device-token");
    assert_eq!(public_push(&keyed, &other).await.0, 200);
}

#[tokio::test]
async fn the_public_endpoint_is_limited_per_ip() {
    let providers = providers().await;
    let keyed = Relay::start_configured(
        RateLimit::default(),
        Limits::default(),
        providers.config.clone(),
    )
    .await;

    let mut accepted = 0u32;
    let mut refused = None;
    for index in 0..400u32 {
        let mut body = forwarded_body();
        body["token"] = json!(format!("token-{index}"));
        match public_push(&keyed, &body).await.0 {
            200 => accepted += 1,
            429 => {
                refused = Some(index);
                break;
            }
            other => panic!("unexpected status {other} on push {index}"),
        }
    }
    let refused = refused.expect("the per-ip bucket never emptied");
    assert!(
        (100..=200).contains(&refused),
        "{refused} pushes were accepted before the ip budget ran out"
    );
    assert_eq!(accepted, refused);
}

#[tokio::test]
async fn a_keyless_relay_without_an_upstream_reports_push_unconfigured() {
    let relay = Relay::start().await;
    let (mut machine, _id) = relay.registered(92).await;

    let reply = machine
        .request(json!({
            "t": "push",
            "platform": "apns",
            "token": APNS_TOKEN,
            "kind": "generic",
            "data": b64url_encode(DATA),
        }))
        .await;
    assert_eq!(reply["t"], "err");
    assert_eq!(reply["code"], "push_unconfigured");
}

#[tokio::test]
async fn an_upstream_that_rejects_the_push_is_reported_back_to_the_machine() {
    let keyless = keyless("http://127.0.0.1:1/v1/push").await;
    let (mut machine, _id) = keyless.registered(93).await;

    let reply = machine
        .request(json!({
            "t": "push",
            "platform": "apns",
            "token": APNS_TOKEN,
            "kind": "generic",
            "data": b64url_encode(DATA),
        }))
        .await;
    assert_eq!(reply["t"], "err");
    assert_eq!(reply["code"], "push_failed");
}
