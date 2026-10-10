mod common;

use std::time::Duration;

use common::bridge::FakeBridge;
use common::daemon::{Options, TestDaemon};
use common::phone::{fetch_bundle, Phone};
use serde_json::json;

const WAIT: Duration = Duration::from_secs(10);
const SHORT: Duration = Duration::from_secs(2);

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_paired_device_reconnects_in_connect_mode() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = FakeBridge::start(daemon.bridge_socket.clone()).await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;
    let offer = daemon.offer().await;

    let mut phone = Phone::new(bundle);
    assert_eq!(phone.pair_lan(addr, &offer).await, Some(false));
    phone.echo("one", WAIT).await;

    phone.disconnect().await;
    assert_eq!(
        phone.connect_lan(addr, WAIT).await,
        Some(true),
        "the same device resumes its session"
    );
    assert_eq!(phone.echo("two", WAIT).await.1, b"echo:two");

    daemon.stop().await;
    bridge.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_unknown_device_is_dropped_without_a_reply() {
    let daemon = TestDaemon::start(Options::default()).await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;

    let mut stranger = Phone::new(bundle);
    assert_eq!(stranger.connect_lan(addr, SHORT).await, None);

    let status = daemon.ask(json!({"cmd": "status"})).await;
    assert_eq!(status["sessions"], json!([]));

    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_revoked_device_is_dropped_without_a_reply() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = FakeBridge::start(daemon.bridge_socket.clone()).await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;
    let offer = daemon.offer().await;

    let mut phone = Phone::new(bundle);
    assert_eq!(phone.pair_lan(addr, &offer).await, Some(false));
    phone.echo("before", WAIT).await;

    let device_id = phone.identity.public().id();
    let reply = daemon
        .ask(json!({"cmd": "revoke", "device": device_id[..8]}))
        .await;
    assert_eq!(reply["device"], device_id);
    assert_eq!(daemon.ask(json!({"cmd": "devices"})).await, json!([]));

    phone.disconnect().await;
    assert_eq!(phone.connect_lan(addr, SHORT).await, None);

    daemon.stop().await;
    bridge.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_consumed_offer_cannot_pair_a_second_device() {
    let daemon = TestDaemon::start(Options::default()).await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;
    let offer = daemon.offer().await;

    let mut first = Phone::new(bundle.clone());
    assert_eq!(first.pair_lan(addr, &offer).await, Some(false));

    let mut second = Phone::new(bundle);
    assert_eq!(
        second.pair_lan(addr, &offer).await,
        None,
        "the offer was consumed by the first pair"
    );

    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_replaced_offer_cannot_pair() {
    let daemon = TestDaemon::start(Options::default()).await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;

    let stale = daemon.offer().await;
    let _current = daemon.offer().await;

    let mut phone = Phone::new(bundle);
    assert_eq!(
        phone.pair_lan(addr, &stale).await,
        None,
        "only the newest offer pairs"
    );

    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_device_beyond_the_limit_is_refused() {
    let daemon = TestDaemon::start(Options::default()).await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;

    for _ in 0..32 {
        let mut phone = Phone::new(bundle.clone());
        let offer = daemon.offer().await;
        assert!(phone.pair_lan(addr, &offer).await.is_some());
    }
    let extra = daemon.offer().await;
    let mut phone = Phone::new(bundle);
    assert_eq!(phone.pair_lan(addr, &extra).await, None);

    daemon.stop().await;
}
