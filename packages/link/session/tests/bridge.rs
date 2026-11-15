mod common;

use broski_link_session::{BridgeState, LinkState, Paired, Route};
use broski_link_testkit::daemon::{Home, TestDaemon};
use common::bridge::{header, BridgeStandIn};
use common::watch::Watch;
use common::{quick, Phone};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bridge_frames_round_trip_to_the_bridge_on_the_daemons_socket() {
    let home = Home::new();
    let daemon = TestDaemon::start(&home, None, true).await;
    let bridge = BridgeStandIn::start(&home.bridge_socket());
    let phone = Phone::new();
    let Paired { session, .. } = phone
        .pair(&daemon, vec![daemon.lan().to_string()], quick())
        .await;
    let mut watch = Watch::new(session);
    watch.connected_on(0, Route::Lan).await;

    watch
        .until("the bridge reported up", |watch| {
            watch
                .bridge_statuses
                .iter()
                .any(|status| status.state == BridgeState::Up && status.conn >= 1)
        })
        .await;

    // A contract frame far larger than one link frame crosses fragmented and comes back whole.
    let large = format!(
        r#"{{"type":"contract","message":"{}"}}"#,
        "x".repeat(1024 * 1024)
    );
    watch.round_trip(&large).await;
    for index in 0..50 {
        watch.send(&format!(r#"{{"n":{index}}}"#));
    }
    watch.echoes(51).await;
    let expected: Vec<String> = (0..50)
        .map(|index| format!(r#"echo:{{"n":{index}}}"#))
        .collect();
    assert_eq!(watch.bridge[1..], expected);
    assert_eq!(bridge.received()[0], large);

    let sessions = bridge.sessions();
    let device = phone.identity.id();
    assert_eq!(
        header(sessions.last().expect("a session"), "x-broski-device-id").as_deref(),
        Some(device.as_str())
    );
    assert!(watch.failures.is_empty());
    assert!(matches!(
        watch.session.status().state,
        LinkState::Connected { .. }
    ));
    bridge.stop();
    daemon.stop().await;
}
