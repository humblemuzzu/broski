mod common;

use broski_relay::limits::{Limits, RateLimit};
use broski_relay::push::PushConfig;
use common::push::{connect, push, push_body, relay_with_push, APNS_TOKEN, DATA, FCM_TOKEN};
use common::{http_post, Relay};
use serde_json::json;

#[tokio::test]
async fn apns_token_rejection_is_reported_as_push_token_invalid() {
    let (relay, providers) = relay_with_push().await;
    let (mut machine, _id) = connect(&relay, 84).await;

    providers.apns.reject(410, r#"{"reason":"BadDeviceToken"}"#);
    let reply = push(
        &mut machine,
        "apns",
        APNS_TOKEN,
        "generic",
        DATA,
        None,
        None,
    )
    .await;
    assert_eq!(reply["t"], "err");
    assert_eq!(reply["code"], "push_token_invalid");

    providers
        .apns
        .reject(400, r#"{"reason":"DeviceTokenNotForTopic"}"#);
    let reply = push(
        &mut machine,
        "apns",
        APNS_TOKEN,
        "generic",
        DATA,
        None,
        None,
    )
    .await;
    assert_eq!(reply["code"], "push_token_invalid");
}

#[tokio::test]
async fn fcm_unregistered_token_is_reported_as_push_token_invalid() {
    let (relay, providers) = relay_with_push().await;
    let (mut machine, _id) = connect(&relay, 85).await;

    providers.fcm.reject(
        404,
        r#"{"error":{"code":404,"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}"#,
    );
    let reply = push(&mut machine, "fcm", FCM_TOKEN, "generic", DATA, None, None).await;
    assert_eq!(reply["t"], "err");
    assert_eq!(reply["code"], "push_token_invalid");
}

#[tokio::test]
async fn provider_failures_are_reported_as_push_failed() {
    let (relay, providers) = relay_with_push().await;
    let (mut machine, _id) = connect(&relay, 86).await;

    providers
        .apns
        .reject(503, r#"{"reason":"ServiceUnavailable"}"#);
    assert_eq!(
        push(
            &mut machine,
            "apns",
            APNS_TOKEN,
            "generic",
            DATA,
            None,
            None
        )
        .await["code"],
        "push_failed"
    );

    providers
        .apns
        .reject(413, r#"{"reason":"PayloadTooLarge"}"#);
    assert_eq!(
        push(
            &mut machine,
            "apns",
            APNS_TOKEN,
            "generic",
            DATA,
            None,
            None
        )
        .await["code"],
        "push_rejected"
    );

    providers.fcm.reject(503, "upstream down");
    assert_eq!(
        push(&mut machine, "fcm", FCM_TOKEN, "generic", DATA, None, None).await["code"],
        "push_failed"
    );
}

#[tokio::test]
async fn a_relay_without_providers_reports_push_unconfigured() {
    let relay = Relay::start_configured(
        RateLimit::default(),
        Limits::default(),
        PushConfig::default(),
    )
    .await;
    let (mut machine, _id) = connect(&relay, 87).await;

    let reply = push(
        &mut machine,
        "apns",
        APNS_TOKEN,
        "generic",
        DATA,
        None,
        None,
    )
    .await;
    assert_eq!(reply["t"], "err");
    assert_eq!(reply["code"], "push_unconfigured");

    let (status, _) = http_post(
        relay.addr,
        "/v1/push",
        &[],
        br#"{"platform":"apns","token":"x","kind":"generic","data":"AA"}"#,
    )
    .await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn the_provider_ceiling_rejects_extra_pushes_instead_of_queueing() {
    let (relay, providers) = relay_with_push().await;
    let (mut machine, _id) = connect(&relay, 90).await;
    providers.apns.slow(500);

    for index in 0..100u64 {
        let mut body = push_body("apns", APNS_TOKEN, "generic", DATA, None, None);
        body["req"] = json!(index + 1);
        machine.send_json(&body).await;
    }

    let mut accepted = 0usize;
    let mut refused = 0usize;
    for _ in 0..100 {
        let reply = machine.text().await;
        match reply["code"].as_str() {
            Some("rate_limited") => refused += 1,
            None if reply["t"] == "ok" => accepted += 1,
            other => panic!("unexpected push reply {reply} ({other:?})"),
        }
    }
    assert!(
        accepted >= 64,
        "only {accepted} pushes reached the provider"
    );
    assert!(refused >= 30, "the provider ceiling never refused a push");
    assert_eq!(providers.apns.requests.count(), accepted);
}

#[tokio::test]
async fn machine_pushes_are_rate_limited_to_120_per_minute() {
    let (relay, providers) = relay_with_push().await;
    let (mut machine, _id) = connect(&relay, 89).await;

    let mut accepted = 0u32;
    let mut refused = None;
    for index in 0..200u32 {
        let reply = push(
            &mut machine,
            "apns",
            APNS_TOKEN,
            "generic",
            DATA,
            None,
            None,
        )
        .await;
        if reply["t"] == "ok" {
            accepted += 1;
        } else if reply["code"] == "rate_limited" {
            refused = Some(index);
            break;
        } else {
            panic!("unexpected push reply {reply} on push {index}");
        }
    }
    let refused = refused.expect("the machine bucket never emptied");
    assert!(
        (120..=180).contains(&refused),
        "{refused} pushes were accepted before the machine budget ran out"
    );
    assert_eq!(accepted, refused);
    assert_eq!(providers.apns.requests.count() as u32, accepted);
}
