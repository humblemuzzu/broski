mod common;

use std::time::Duration;

use broski_link_session::{
    pair, DeviceIdentity, Error, MachineRecord, Offer, Paired, PairingCredentials, Route, Session,
};
use common::bridge::{header, BridgeStandIn};
use common::daemon::{Home, TestDaemon};
use common::relay::TestRelay;
use common::watch::{resumed, Watch, WAIT};
use common::{await_identity, options, quick, Phone};
use serde_json::{json, Value};
use tokio::time::Instant;

/// Polls the daemon until `check` holds; the daemon applies a control message on its own time.
async fn eventually(
    daemon: &TestDaemon,
    what: &str,
    request: Value,
    check: impl Fn(&Value) -> bool,
) {
    let deadline = Instant::now() + WAIT;
    loop {
        if check(&daemon.ask(request.clone()).await) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "the daemon never reported {what}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// The record names the machine the daemon reports and carries everything a later session and
/// the notification handlers need.
fn assert_paired_record(record: &MachineRecord, machine: &Value, phone: &Phone, lan: &str) {
    assert_eq!(record.id, machine["id"]);
    assert_eq!(record.name, machine["name"]);
    assert_eq!(record.device_id, phone.identity.id());
    assert_eq!(record.relay_token.as_ref().map(String::len), Some(43));
    assert_eq!(record.push_key.len(), 32);
    assert_eq!(record.relay, None);
    assert!(
        record.lan.iter().any(|route| route == lan),
        "the address that paired is kept: {:?}",
        record.lan
    );
}

/// The daemon stored the phone's `hello`, and the bridge saw only this device's sessions.
async fn assert_announced(daemon: &TestDaemon, bridge: &BridgeStandIn, device: &str) {
    eventually(
        daemon,
        "the phone's hello",
        json!({"cmd": "devices"}),
        |devices| {
            devices[0]["id"] == device
                && devices[0]["name"] == "test phone"
                && devices[0]["platform"] == "ios"
        },
    )
    .await;
    let sessions = bridge.sessions();
    assert!(!sessions.is_empty());
    for headers in sessions {
        assert_eq!(
            header(&headers, "x-broski-device-id").as_deref(),
            Some(device)
        );
        assert_eq!(header(&headers, "x-broski-role").as_deref(), Some("owner"));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pairs_over_the_lan_with_the_offer_the_daemon_made() {
    let home = Home::new();
    let daemon = TestDaemon::start(&home, None, true).await;
    let bridge = BridgeStandIn::start(&home.bridge_socket());
    let phone = Phone::new();
    let lan = daemon.lan().to_string();

    let Paired { session, record } = phone.pair(&daemon, vec![lan.clone()], quick()).await;
    let machine = daemon.ask(json!({"cmd": "status"})).await["machine"].clone();
    assert_paired_record(&record, &machine, &phone, &lan);

    let mut watch = Watch::new(session);
    let connected = watch.connected_after(0).await;
    assert_eq!(connected.route, Some(Route::Lan));
    assert_eq!(connected.route_detail.as_deref(), Some(lan.as_str()));
    assert_eq!(
        resumed(&connected),
        Some(false),
        "a pairing is a fresh session"
    );
    watch.round_trip("hi").await;
    assert_announced(&daemon, &bridge, &phone.identity.id()).await;
    bridge.stop();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pairs_entirely_over_the_relay_then_resumes_on_its_own_credentials() {
    let relay = TestRelay::start().await;
    let home = Home::new();
    let daemon = TestDaemon::start(&home, Some(&relay.url), false).await;
    let bridge = BridgeStandIn::start(&home.bridge_socket());
    await_identity(&relay, &daemon).await;
    let phone = Phone::new();

    let Paired { session, record } = phone.pair(&daemon, Vec::new(), quick()).await;
    assert_eq!(record.relay.as_deref(), Some(relay.url.as_str()));
    assert!(record.lan.is_empty());

    let mut watch = Watch::new(session);
    let paired = watch.connected_on(0, Route::Relay).await;
    assert_eq!(resumed(&paired), Some(false));
    // The machine retires the offer's relay device right after `paired`, which closes that
    // socket; the session comes back on the device's own token and keeps its session.
    let after = watch
        .statuses
        .iter()
        .position(|status| status == &paired)
        .expect("seen")
        + 1;
    let own = watch.connected_on(after, Route::Relay).await;
    assert_eq!(resumed(&own), Some(true));
    watch.round_trip("over the relay").await;
    assert_eq!(bridge.received(), ["over the relay"]);
    bridge.stop();
    daemon.stop().await;
    relay.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_stored_record_reconnects_in_connect_mode() {
    let home = Home::new();
    let daemon = TestDaemon::start(&home, None, true).await;
    let bridge = BridgeStandIn::start(&home.bridge_socket());
    let phone = Phone::new();
    let Paired { session, record } = phone
        .pair(&daemon, vec![daemon.lan().to_string()], quick())
        .await;
    drop(session);

    let session = Session::start(&phone.runtime, &phone.identity, record, options(quick()))
        .expect("the record starts a session");
    let mut watch = Watch::new(session);
    let connected = watch.connected_on(0, Route::Lan).await;
    assert_eq!(
        resumed(&connected),
        Some(false),
        "this session held no link session yet"
    );
    watch.round_trip("again").await;
    assert_eq!(bridge.received(), ["again"]);
    bridge.stop();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_address_serving_another_machine_is_refused() {
    let (home, other_home) = (Home::new(), Home::new());
    let daemon = TestDaemon::start(&home, None, true).await;
    let other = TestDaemon::start(&other_home, None, true).await;
    let phone = Phone::new();
    let mut offer = daemon.offer().await;
    offer.lan = vec![other.lan().to_string()];
    let offer = Offer::parse(&offer.to_uri()).expect("offer");

    let result = pair(&phone.runtime, &phone.identity, offer, options(quick())).await;
    assert!(
        matches!(result, Err(Error::FingerprintMismatch)),
        "{:?}",
        result.err()
    );
    daemon.stop().await;
    other.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_offer_nobody_answers_or_that_expired_is_refused() {
    let home = Home::new();
    let daemon = TestDaemon::start(&home, None, true).await;
    let phone = Phone::new();

    let mut offer = daemon.offer().await;
    offer.lan = phone.record_nobody_serves().lan;
    let unreachable = Offer::parse(&offer.to_uri()).expect("offer");
    let result = pair(
        &phone.runtime,
        &phone.identity,
        unreachable,
        options(quick()),
    )
    .await;
    assert!(
        matches!(result, Err(Error::MachineUnreachable)),
        "{:?}",
        result.err()
    );

    offer.lan = vec![daemon.lan().to_string()];
    offer.expires_at = 1;
    let expired = Offer::parse(&offer.to_uri()).expect("offer");
    assert!(expired.is_expired(2));
    let result = pair(&phone.runtime, &phone.identity, expired, options(quick())).await;
    assert!(
        matches!(result, Err(Error::OfferExpired)),
        "{:?}",
        result.err()
    );
    daemon.stop().await;
}

#[test]
fn the_phone_derives_the_pairing_device_the_daemon_authorises() {
    for seed in 0..32u8 {
        let secret: [u8; 32] =
            std::array::from_fn(|index| (index as u8).wrapping_mul(seed).wrapping_add(seed));
        let credentials = PairingCredentials::derive(&secret);
        assert_eq!(
            credentials.device_id,
            broski_link_daemon::pairing::device_id(&secret)
        );
        assert_eq!(
            credentials.token,
            broski_link_daemon::pairing::token(&secret)
        );
    }
}

#[test]
fn a_record_for_another_identity_or_machine_does_not_start() {
    let phone = Phone::new();
    let record = phone.record_nobody_serves();
    let start = |record| Session::start(&phone.runtime, &phone.identity, record, options(quick()));
    assert!(start(record.clone()).is_ok());
    let mut foreign = record.clone();
    foreign.device_id = DeviceIdentity::generate().expect("identity").id();
    assert!(matches!(start(foreign), Err(Error::Record(_))));
    let mut wrong_bundle = record.clone();
    wrong_bundle.id = phone.identity.id();
    assert!(matches!(start(wrong_bundle), Err(Error::Record(_))));
    let mut short_key = record;
    short_key.push_key.pop();
    assert!(matches!(start(short_key), Err(Error::Record(_))));
}
