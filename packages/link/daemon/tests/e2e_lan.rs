mod common;

use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use common::bridge::FakeBridge;
use common::daemon::{Options, TestDaemon};
use common::phone::{fetch_bundle, Phone};
use serde_json::json;

const WAIT: Duration = Duration::from_secs(10);

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn lan_pairing_then_stream_one_echo() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = FakeBridge::start(daemon.bridge_socket.clone()).await;
    let addr = daemon.lan();

    let bundle = fetch_bundle(addr).await;
    let offer = daemon.offer().await;
    assert_eq!(
        offer.fingerprint,
        bundle.fingerprint(),
        "the offer fingerprints the bundle /v1/identity serves"
    );

    let mut phone = Phone::new(bundle);
    assert_eq!(
        phone.pair_lan(addr, &offer).await,
        Some(false),
        "the first connect starts a fresh session"
    );

    let device_id = phone.identity.public().id();
    let paired = phone.await_control("paired", WAIT).await;
    assert_eq!(paired["device_id"], device_id);
    assert_eq!(paired["machine"]["name"], offer.name);
    assert_eq!(paired["machine"]["lan"], json!(offer.lan));
    assert_eq!(
        paired["relay_token"].as_str().expect("relay token").len(),
        43,
        "a 32-byte token in b64url"
    );

    let routes = phone.await_control("routes", WAIT).await;
    assert_eq!(routes["relay"], json!(null));
    phone.await_control("bridge", WAIT).await;

    let echoed = phone.echo("hello bridge", WAIT).await;
    assert_eq!(echoed.0, 1);
    assert_eq!(echoed.1, b"echo:hello bridge");
    assert_eq!(bridge.received(), vec!["hello bridge".to_owned()]);
    assert_one_session(&bridge, &device_id);

    daemon.stop().await;
    bridge.stop().await;
}

/// One device session dialled the bridge, under the right id and role.
fn assert_one_session(bridge: &FakeBridge, device_id: &str) {
    assert_eq!(bridge.session_count(), 1);
    assert_eq!(
        bridge.session_header(0, "x-broski-device-id").as_deref(),
        Some(device_id)
    );
    assert_eq!(
        bridge.session_header(0, "x-broski-role").as_deref(),
        Some("owner")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_hello_names_the_device_and_redials_the_bridge() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = FakeBridge::start(daemon.bridge_socket.clone()).await;
    let addr = daemon.lan();

    let bundle = fetch_bundle(addr).await;
    let offer = daemon.offer().await;
    let mut phone = Phone::new(bundle);
    assert_eq!(phone.pair_lan(addr, &offer).await, Some(false));
    phone.await_control("paired", WAIT).await;
    phone.echo("first", WAIT).await;

    phone
        .send_control(
            json!({"t": "hello", "name": "Sam's iPhone", "platform": "ios", "app": "1.0"}),
        )
        .await;

    let deadline = std::time::Instant::now() + WAIT;
    while bridge.session_count() < 2 {
        assert!(
            std::time::Instant::now() < deadline,
            "the bridge was not redialled"
        );
        phone.step().await;
    }
    assert_eq!(
        bridge.session_header(1, "x-broski-device-name").as_deref(),
        Some("Sam's iPhone")
    );

    let devices = daemon.ask(json!({"cmd": "devices"})).await;
    assert_eq!(devices[0]["name"], "Sam's iPhone");
    assert_eq!(devices[0]["platform"], "ios");

    daemon.stop().await;
    bridge.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn state_files_are_private() {
    let daemon = TestDaemon::start(Options::default()).await;
    let home = std::fs::metadata(&daemon.home).expect("home");
    assert_eq!(home.permissions().mode() & 0o777, 0o700);
    for name in ["identity", "state.json", "devices.json"] {
        let entry = std::fs::metadata(daemon.home.join(name))
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(entry.permissions().mode() & 0o777, 0o600, "{name}");
    }
    let control = control_socket_mode(&daemon);
    assert_eq!(control & 0o777, 0o600, "control.sock");
    daemon.stop().await;
}

fn control_socket_mode(daemon: &TestDaemon) -> u32 {
    std::fs::metadata(daemon.control_path())
        .expect("control socket")
        .permissions()
        .mode()
}
