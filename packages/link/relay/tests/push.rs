mod common;

use common::push::{
    apns_claims, apns_header, connect, fcm_assertion_claims, push, relay_with_push, APNS_TOKEN,
    DATA, FCM_TOKEN,
};
use common::{APNS_TOPIC, FCM_PROJECT};
use jsonwebtoken::Algorithm;
use serde_json::json;

#[tokio::test]
async fn apns_push_carries_the_documented_headers_and_body() {
    let (relay, providers) = relay_with_push().await;
    let (mut machine, id) = connect(&relay, 80).await;

    let reply = push(
        &mut machine,
        "apns",
        APNS_TOKEN,
        "approval",
        DATA,
        Some("collapse-1"),
        Some("high"),
    )
    .await;
    assert_eq!(reply["t"], "ok", "{reply}");

    let requests = providers.apns.requests.all();
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    assert_eq!(request.path, format!("/3/device/{APNS_TOKEN}"));
    assert_eq!(request.header("apns-topic"), APNS_TOPIC);
    assert_eq!(request.header("apns-push-type"), "alert");
    assert_eq!(request.header("apns-priority"), "10");
    assert_eq!(request.header("apns-collapse-id"), "collapse-1");
    assert_eq!(request.header("content-type"), "application/json");

    let authorization = request.header("authorization");
    let assertion = authorization
        .strip_prefix("bearer ")
        .expect("bearer assertion");
    let header = apns_header(assertion);
    assert_eq!(header.alg, Algorithm::ES256);
    assert_eq!(apns_claims(assertion)["iss"], common::APNS_TEAM_ID);

    let body = request.json();
    assert_eq!(body["aps"]["alert"]["title"], "Broski");
    assert_eq!(body["aps"]["alert"]["body"], "New activity");
    assert_eq!(body["aps"]["mutable-content"], 1);
    assert_eq!(body["aps"]["category"], "approval");
    assert_eq!(body["aps"]["sound"], "default");
    assert_eq!(body["m"], id);
    assert_eq!(body["k"], "approval");
    assert_eq!(body["e"], broski_relay::auth::b64url_encode(DATA));
}

#[tokio::test]
async fn apns_priority_and_sound_follow_the_kind() {
    let (relay, providers) = relay_with_push().await;
    let (mut machine, _id) = connect(&relay, 81).await;

    let reply = push(&mut machine, "apns", APNS_TOKEN, "done", DATA, None, None).await;
    assert_eq!(reply["t"], "ok", "{reply}");
    let request = &providers.apns.requests.all()[0];
    assert_eq!(request.header("apns-priority"), "10", "default is high");
    assert_eq!(request.header("apns-collapse-id"), "");

    let cases = [
        ("attention", "normal", "5", false),
        ("done", "normal", "5", true),
        ("approval", "high", "10", false),
    ];
    for (kind, priority, _, _) in cases {
        let reply = push(
            &mut machine,
            "apns",
            APNS_TOKEN,
            kind,
            DATA,
            None,
            Some(priority),
        )
        .await;
        assert_eq!(reply["t"], "ok", "{reply}");
    }

    let requests = providers.apns.requests.all();
    for (index, (kind, _, priority, silent)) in cases.iter().enumerate() {
        let request = &requests[index + 1];
        assert_eq!(request.header("apns-priority"), *priority);
        let body = request.json();
        assert_eq!(body["aps"]["category"], *kind);
        if *silent {
            assert!(body["aps"]["sound"].is_null(), "{kind} should be silent");
        } else {
            assert_eq!(body["aps"]["sound"], "default", "{kind} should be audible");
        }
    }
}

#[tokio::test]
async fn fcm_push_exchanges_a_service_account_assertion_then_sends_a_data_message() {
    let (relay, providers) = relay_with_push().await;
    let (mut machine, id) = connect(&relay, 82).await;
    let token_endpoint = format!("{}/token", providers.fcm.base);

    let reply = push(
        &mut machine,
        "fcm",
        FCM_TOKEN,
        "attention",
        DATA,
        Some("collapse-2"),
        Some("high"),
    )
    .await;
    assert_eq!(reply["t"], "ok", "{reply}");

    let exchanges = providers.fcm.token_requests.all();
    assert_eq!(exchanges.len(), 1);
    let claims = fcm_assertion_claims(&exchanges[0].body, &token_endpoint);
    assert_eq!(
        claims["scope"],
        "https://www.googleapis.com/auth/firebase.messaging"
    );
    assert!(claims["exp"].as_u64().expect("exp") > claims["iat"].as_u64().expect("iat"));

    let requests = providers.fcm.requests.all();
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    assert_eq!(
        request.path,
        format!("/v1/projects/{FCM_PROJECT}/messages:send")
    );
    assert_eq!(request.header("authorization"), "Bearer mock-access-token");
    let body = request.json();
    assert_eq!(body["message"]["token"], FCM_TOKEN);
    assert_eq!(body["message"]["data"]["m"], id);
    assert_eq!(body["message"]["data"]["k"], "attention");
    assert_eq!(
        body["message"]["data"]["e"],
        broski_relay::auth::b64url_encode(DATA)
    );
    assert_eq!(body["message"]["android"]["priority"], "HIGH");
    assert_eq!(body["message"]["android"]["collapse_key"], "collapse-2");
    assert!(body["message"]["notification"].is_null(), "data only");
}

#[tokio::test]
async fn fcm_access_token_is_cached_between_pushes() {
    let (relay, providers) = relay_with_push().await;
    let (mut machine, _id) = connect(&relay, 83).await;

    for _ in 0..3 {
        let reply = push(&mut machine, "fcm", FCM_TOKEN, "generic", DATA, None, None).await;
        assert_eq!(reply["t"], "ok", "{reply}");
    }
    assert_eq!(providers.fcm.requests.count(), 3);
    assert_eq!(providers.fcm.token_requests.count(), 1);
    let body = providers.fcm.requests.all()[0].json();
    assert_eq!(body["message"]["android"]["priority"], "HIGH");
    assert!(body["message"]["android"]["collapse_key"].is_null());
}

#[tokio::test]
async fn malformed_push_fields_are_bad_request_without_closing_the_socket() {
    let (relay, providers) = relay_with_push().await;
    let (mut machine, _id) = connect(&relay, 88).await;

    let oversized = broski_relay::auth::b64url_encode(&vec![1u8; 3073]);
    let attempts = [
        json!({"t": "push", "platform": "sms", "token": APNS_TOKEN, "kind": "generic", "data": "AA"}),
        json!({"t": "push", "platform": "apns", "token": "", "kind": "generic", "data": "AA"}),
        json!({"t": "push", "platform": "apns", "token": APNS_TOKEN, "kind": "shouting", "data": "AA"}),
        json!({"t": "push", "platform": "apns", "token": APNS_TOKEN, "kind": "offline", "data": "AA"}),
        json!({"t": "push", "platform": "apns", "token": APNS_TOKEN, "kind": "generic"}),
        json!({"t": "push", "platform": "apns", "token": APNS_TOKEN, "kind": "generic", "data": "not base64!"}),
        json!({"t": "push", "platform": "apns", "token": APNS_TOKEN, "kind": "generic", "data": oversized}),
        json!({"t": "push", "platform": "apns", "token": APNS_TOKEN, "kind": "generic", "data": "AA", "priority": "urgent"}),
        json!({"t": "push", "platform": "apns", "token": APNS_TOKEN, "kind": "generic", "data": "AA", "collapse": "x".repeat(65)}),
    ];

    for attempt in attempts {
        let reply = machine.request(attempt.clone()).await;
        assert_eq!(reply["code"], "bad_request", "for {attempt}");
    }

    let widest = broski_relay::auth::b64url_encode(&vec![1u8; 3072]);
    let reply = machine
        .request(json!({"t": "push", "platform": "apns", "token": APNS_TOKEN, "kind": "generic", "data": widest}))
        .await;
    assert_eq!(reply["t"], "ok", "{reply}");
    assert_eq!(
        providers.apns.requests.count(),
        1,
        "nothing else reached apns"
    );
}
