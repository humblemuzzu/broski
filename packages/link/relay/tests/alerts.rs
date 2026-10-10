mod common;

use std::time::{Duration, Instant};

use broski_relay::auth::b64url_decode;
use broski_relay::limits::{Limits, RateLimit};
use common::{
    providers, upstream_push_config, Client, Providers, Relay, APNS_TOPIC, DEVICE_A, DEVICE_B,
};
use serde_json::{json, Value};

const GRACE: Duration = Duration::from_millis(400);
const APNS_TOKEN: &str = "11223344556677889900aabbccddeeff11223344556677889900aabbccddee";
const FCM_TOKEN: &str = "alert-fcm-token:APA91bExample";

fn fast_alerts() -> Limits {
    Limits {
        alert_grace: GRACE,
        ..Limits::default()
    }
}

async fn providers_with_fast_alerts() -> (Relay, Providers) {
    let providers = providers().await;
    let relay = Relay::start_configured(
        RateLimit::default(),
        fast_alerts(),
        providers.config.clone(),
    )
    .await;
    (relay, providers)
}

async fn watching_machine(
    relay: &Relay,
    seed: u8,
    targets: &[(&str, &str, &str)],
) -> (Client, String) {
    let (mut machine, id) = relay.registered(seed).await;
    assert_eq!(machine.alert_targets(targets).await["t"], "ok");
    assert_eq!(machine.watch(true).await["t"], "ok");
    (machine, id)
}

fn offline_payload(encoded: &str) -> Value {
    let decoded = b64url_decode(encoded).expect("b64url payload");
    assert!(decoded.len() <= 3072);
    serde_json::from_slice(&decoded).expect("offline payload json")
}

#[tokio::test]
async fn a_watched_machine_that_stays_away_is_alerted_as_offline() {
    let (relay, providers) = providers_with_fast_alerts().await;
    let (machine, id) = watching_machine(&relay, 100, &[(DEVICE_A, "apns", APNS_TOKEN)]).await;

    let dropped = Instant::now();
    drop(machine);

    let requests = providers.apns.requests.wait(1).await;
    assert!(
        dropped.elapsed() >= GRACE - Duration::from_millis(100),
        "alerted after {:?}, before the grace elapsed",
        dropped.elapsed()
    );
    assert!(dropped.elapsed() < Duration::from_secs(5));
    let request = &requests[0];
    assert_eq!(request.path, format!("/3/device/{APNS_TOKEN}"));
    assert_eq!(request.header("apns-topic"), APNS_TOPIC);
    assert_eq!(request.header("apns-priority"), "10");
    assert_eq!(
        request.header("apns-collapse-id"),
        format!("offline-{}", &id[..8])
    );
    let body = request.json();
    assert_eq!(body["k"], "offline");
    assert_eq!(body["aps"]["category"], "offline");
    assert_eq!(body["m"], id);
    let payload = offline_payload(body["e"].as_str().expect("e"));
    assert_eq!(payload["machine"], id);
    assert_eq!(payload["state"], "offline");
    assert!(payload["since"].as_i64().expect("since") > 0);
    assert_eq!(
        payload.as_object().expect("object").len(),
        3,
        "the relay-built payload carries machine, state and since only: {payload}"
    );
}

#[tokio::test]
async fn a_machine_that_comes_back_inside_the_grace_is_not_alerted() {
    let (relay, providers) = providers_with_fast_alerts().await;
    let (machine, id) = watching_machine(&relay, 101, &[(DEVICE_A, "apns", APNS_TOKEN)]).await;
    drop(machine);

    tokio::time::sleep(GRACE / 3).await;
    let mut machine = relay.machine(&id, "secret").await.expect("machine returns");
    assert_eq!(machine.watch(true).await["t"], "ok");

    providers.apns.requests.quiet(GRACE * 2).await;
}

#[tokio::test]
async fn a_machine_that_is_not_watched_is_not_alerted() {
    let (relay, providers) = providers_with_fast_alerts().await;
    let (mut machine, _id) = relay.registered(102).await;
    assert_eq!(
        machine
            .alert_targets(&[(DEVICE_A, "apns", APNS_TOKEN)])
            .await["t"],
        "ok"
    );
    assert_eq!(machine.watch(false).await["t"], "ok");
    drop(machine);

    providers.apns.requests.quiet(GRACE * 2).await;
}

#[tokio::test]
async fn a_sleeping_watched_machine_is_alerted_as_asleep_once() {
    let (relay, providers) = providers_with_fast_alerts().await;
    let (mut machine, id) = watching_machine(&relay, 103, &[(DEVICE_A, "apns", APNS_TOKEN)]).await;

    machine.send_json(&json!({"t": "sleep"})).await;
    let requests = providers.apns.requests.wait(1).await;
    let body = requests[0].json();
    assert_eq!(body["k"], "offline");
    let payload = offline_payload(body["e"].as_str().expect("e"));
    assert_eq!(payload["machine"], id);
    assert_eq!(payload["state"], "asleep");

    drop(machine);
    providers.apns.requests.quiet(GRACE * 2).await;
}

#[tokio::test]
async fn alert_targets_are_validated_capped_and_replaced() {
    let (relay, providers) = providers_with_fast_alerts().await;
    let (mut machine, _id) = relay.registered(104).await;

    let many: Vec<(String, String, String)> = (0..32)
        .map(|index| {
            (
                format!("{index:032x}"),
                "apns".to_owned(),
                APNS_TOKEN.to_owned(),
            )
        })
        .collect();
    let borrowed: Vec<(&str, &str, &str)> = many
        .iter()
        .map(|(device, platform, token)| (device.as_str(), platform.as_str(), token.as_str()))
        .collect();
    assert_eq!(machine.alert_targets(&borrowed).await["t"], "ok");

    let mut too_many = many.clone();
    too_many.push(("f".repeat(32), "apns".to_owned(), APNS_TOKEN.to_owned()));
    let borrowed: Vec<(&str, &str, &str)> = too_many
        .iter()
        .map(|(device, platform, token)| (device.as_str(), platform.as_str(), token.as_str()))
        .collect();
    assert_eq!(
        machine.alert_targets(&borrowed).await["code"],
        "too_many_targets"
    );

    for bad in [
        json!([{"device": format!("{0:032x}", 1), "platform": "sms", "token": APNS_TOKEN}]),
        json!([{"device": "not-hex", "platform": "apns", "token": APNS_TOKEN}]),
        json!([{"device": format!("{0:032x}", 1), "platform": "apns", "token": ""}]),
    ] {
        let reply = machine
            .request(json!({"t": "alert_targets", "targets": bad}))
            .await;
        assert_eq!(reply["code"], "bad_target", "for {bad}");
    }
    assert_eq!(
        machine.request(json!({"t": "alert_targets"})).await["code"],
        "bad_target"
    );

    assert_eq!(
        machine
            .alert_targets(&[(DEVICE_A, "apns", APNS_TOKEN), (DEVICE_B, "fcm", FCM_TOKEN)])
            .await["t"],
        "ok"
    );
    assert_eq!(machine.watch(true).await["t"], "ok");
    drop(machine);

    providers.apns.requests.wait(1).await;
    providers.fcm.requests.wait(1).await;
    assert_eq!(providers.apns.requests.count(), 1);
    assert_eq!(providers.fcm.requests.count(), 1);
    let body = providers.fcm.requests.all()[0].json();
    assert_eq!(body["message"]["token"], FCM_TOKEN);
    assert_eq!(body["message"]["data"]["k"], "offline");
    let payload = offline_payload(body["message"]["data"]["e"].as_str().expect("e"));
    assert_eq!(payload["state"], "offline");
}

#[tokio::test]
async fn a_keyless_relay_forwards_offline_alerts_to_its_upstream() {
    let providers = providers().await;
    let keyed = Relay::start_configured(
        RateLimit::default(),
        Limits::default(),
        providers.config.clone(),
    )
    .await;
    let keyless = Relay::start_configured(
        RateLimit::default(),
        fast_alerts(),
        upstream_push_config(&format!("http://{}/v1/push", keyed.addr)).await,
    )
    .await;

    let (machine, id) = watching_machine(&keyless, 105, &[(DEVICE_A, "apns", APNS_TOKEN)]).await;
    drop(machine);

    let requests = providers.apns.requests.wait(1).await;
    let body = requests[0].json();
    assert_eq!(body["k"], "offline");
    assert_eq!(body["m"], id);
    assert_eq!(
        offline_payload(body["e"].as_str().expect("e"))["machine"],
        id
    );
}
