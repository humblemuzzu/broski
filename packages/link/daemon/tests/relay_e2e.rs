mod common;

use std::time::Duration;

use common::bridge::FakeBridge;
use common::daemon::{Options, TestDaemon};
use common::phone::{fetch_bundle, Phone};
use common::relay::TestRelay;

const WAIT: Duration = Duration::from_secs(20);
const BATCH: usize = 50;

async fn send_batch(phone: &mut Phone, count: usize) {
    for index in 0..count {
        phone.send(1, format!("r{index}").as_bytes()).await;
    }
}

async fn expect_echoes(phone: &mut Phone, count: usize) {
    for index in 0..count {
        let (stream, bytes) = phone.next_message(WAIT).await;
        assert_eq!(stream, 1);
        assert_eq!(
            String::from_utf8(bytes).expect("utf8"),
            format!("echo:r{index}"),
            "message {index} survived the route switch"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_session_moves_from_lan_to_the_relay_and_back() {
    let relay = TestRelay::start().await;
    let daemon = TestDaemon::start(Options {
        relay: Some(relay.url.clone()),
        ..Options::default()
    })
    .await;
    let bridge = FakeBridge::start(daemon.bridge_socket.clone()).await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;
    let machine = bundle.id();
    let offer = daemon.offer().await;

    let mut phone = Phone::new(bundle);
    assert_eq!(phone.pair_lan(addr, &offer).await, Some(false));
    let (device, token) = phone.paired_credentials(WAIT).await;
    assert_eq!(phone.echo("over lan", WAIT).await.1, b"echo:over lan");

    phone.disconnect().await;
    assert!(
        phone
            .reconnect_relay(relay.addr, &machine, &device, &token, WAIT)
            .await,
        "the relay channel resumes the lan session"
    );
    assert_eq!(phone.echo("over relay", WAIT).await.1, b"echo:over relay");
    send_batch(&mut phone, BATCH).await;

    phone.disconnect().await;
    assert_eq!(
        phone.connect_lan(addr, WAIT).await,
        Some(true),
        "the same session comes back over the lan"
    );
    expect_echoes(&mut phone, BATCH).await;
    assert_eq!(
        bridge.session_count(),
        1,
        "the bridge never noticed the route switch"
    );

    daemon.stop().await;
    bridge.stop().await;
    relay.stop().await;
}
