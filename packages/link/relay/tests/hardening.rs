mod common;

use std::time::Duration;

use broski_relay::limits::{Limits, RateLimit};
use common::{bundle_of, machine_id, providers, Relay, DEVICE_A, DEVICE_B, TOKEN_A, TOKEN_B, WAIT};
use serde_json::json;

const REGISTER: &str = "register-token-0123456789";
const APNS_TOKEN: &str = "11223344556677889900aabbccddeeff11223344556677889900aabbccddee";

async fn eventually(what: &str, check: impl Fn() -> bool) {
    let deadline = tokio::time::Instant::now() + WAIT;
    while !check() {
        assert!(tokio::time::Instant::now() < deadline, "{what}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn a_relay_with_a_register_token_registers_only_machines_that_present_it() {
    let relay = Relay::start_registering_with(REGISTER).await;
    let id = machine_id(&bundle_of(40));

    assert_eq!(relay.machine(&id, "secret").await.err(), Some(403));
    assert_eq!(
        relay
            .machine_registering(&id, "secret", "not-the-token-xxxxxx")
            .await
            .err(),
        Some(403)
    );
    let first = relay
        .machine_registering(&id, "secret", REGISTER)
        .await
        .expect("registers with the token");
    drop(first);

    relay
        .machine(&id, "secret")
        .await
        .expect("a registered machine reconnects without the token");
    assert_eq!(relay.machine(&id, "other").await.err(), Some(401));
}

#[tokio::test]
async fn keep_forgets_every_device_the_machine_no_longer_names() {
    let relay = Relay::start().await;
    let (mut machine, id) = relay.registered(41).await;
    assert_eq!(machine.allow(DEVICE_A, TOKEN_A).await["t"], "ok");
    assert_eq!(machine.allow(DEVICE_B, TOKEN_B).await["t"], "ok");
    let mut gone = relay
        .device(&id, DEVICE_B, TOKEN_B)
        .await
        .expect("device b");
    assert_eq!(gone.state().await.0, "online");
    machine.open_channel().await;

    let reply = machine
        .request(json!({"t": "keep", "devices": [DEVICE_A]}))
        .await;
    assert_eq!(reply["t"], "ok");

    assert_eq!(gone.drain_close().await, 4003);
    assert_eq!(relay.device(&id, DEVICE_B, TOKEN_B).await.err(), Some(401));
    relay
        .device(&id, DEVICE_A, TOKEN_A)
        .await
        .expect("a kept device still connects");
}

#[tokio::test]
async fn keep_refuses_a_list_it_cannot_trust() {
    let relay = Relay::start().await;
    let (mut machine, _) = relay.registered(42).await;
    let reply = machine
        .request(json!({"t": "keep", "devices": ["not-an-id"]}))
        .await;
    assert_eq!(reply["code"], "bad_device");
    let too_many: Vec<String> = (0..34).map(|index| format!("{index:032x}")).collect();
    let reply = machine
        .request(json!({"t": "keep", "devices": too_many}))
        .await;
    assert_eq!(reply["code"], "bad_device");
}

#[tokio::test]
async fn a_room_nobody_holds_is_forgotten() {
    let relay = Relay::start().await;
    let (mut machine, id) = relay.registered(43).await;
    assert_eq!(machine.allow(DEVICE_A, TOKEN_A).await["t"], "ok");
    let device = relay.device(&id, DEVICE_A, TOKEN_A).await.expect("device");
    let hub = relay.hub();
    assert!(hub.room(&id).is_some());

    drop(device);
    drop(machine);
    eventually("the room outlived every socket", || hub.room(&id).is_none()).await;

    let mut back = relay.machine(&id, "secret").await.expect("machine returns");
    assert_eq!(back.allow(DEVICE_A, TOKEN_A).await["t"], "ok");
    let mut device = relay.device(&id, DEVICE_A, TOKEN_A).await.expect("device");
    assert_eq!(device.state().await.0, "online");
}

#[tokio::test]
async fn a_machine_that_arms_its_alert_again_and_again_is_alerted_once() {
    let providers = providers().await;
    let limits = Limits {
        alert_grace: Duration::from_millis(300),
        ..Limits::default()
    };
    let relay =
        Relay::start_configured(RateLimit::default(), limits, providers.config.clone()).await;
    let (mut machine, _) = relay.registered(44).await;
    assert_eq!(
        machine
            .alert_targets(&[(DEVICE_A, "apns", APNS_TOKEN)])
            .await["t"],
        "ok"
    );
    assert_eq!(machine.watch(true).await["t"], "ok");

    for _ in 0..200 {
        machine.send_json(&json!({"t": "sleep"})).await;
    }
    providers.apns.requests.wait(1).await;
    providers
        .apns
        .requests
        .quiet(Duration::from_millis(900))
        .await;
    assert_eq!(providers.apns.requests.count(), 1);
}

#[tokio::test]
async fn identity_lookups_are_rate_limited_per_address() {
    let relay = Relay::start().await;
    let (_machine, id) = relay.registered(45).await;
    let path = format!("/v1/identity/{id}");
    let mut limited = false;
    for _ in 0..400 {
        if common::http_get(relay.addr, &path, &[]).await.0 == 429 {
            limited = true;
            break;
        }
    }
    assert!(limited, "400 identity lookups in a row were never limited");
}
