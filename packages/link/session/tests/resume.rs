mod common;

use broski_link_session::{
    BridgeState, LinkState, Paired, Route, SendFailure, Session, WaitReason,
};
use broski_link_testkit::await_identity;
use broski_link_testkit::daemon::{Home, TestDaemon};
use broski_link_testkit::forwarder::Forwarder;
use broski_link_testkit::relay::TestRelay;
use common::bridge::BridgeStandIn;
use common::watch::{resumed, session_reset, Watch};
use common::{options, quick, Phone};

const TOTAL: usize = 200;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_socket_dropped_mid_stream_resumes_without_loss_or_duplication() {
    let home = Home::new();
    let daemon = TestDaemon::start(&home, None, true).await;
    let bridge = BridgeStandIn::start(&home.bridge_socket());
    let lan = Forwarder::start(daemon.lan()).await;
    let phone = Phone::new();
    let Paired { session, .. } = phone.pair(&daemon, vec![lan.route()], quick()).await;
    let mut watch = Watch::new(session);
    watch.connected_on(0, Route::Lan).await;
    watch.round_trip("first").await;
    let bridge_sockets = bridge.sessions().len();

    let mut drops = 0;
    for index in 0..TOTAL {
        watch.send(&format!("m{index:03}"));
        if index % 40 == 20 {
            // The socket dies with frames in flight in both directions.
            let mark = watch.mark();
            lan.drop_connections();
            let back = watch.connected_on(mark, Route::Lan).await;
            assert_eq!(resumed(&back), Some(true), "drop {drops} resumed");
            drops += 1;
        }
    }
    watch.echoes(TOTAL + 1).await;

    let sent: Vec<String> = (0..TOTAL).map(|index| format!("m{index:03}")).collect();
    let echoed: Vec<String> = sent.iter().map(|text| format!("echo:{text}")).collect();
    assert_eq!(
        watch.bridge[1..],
        echoed,
        "every echo exactly once, in order"
    );
    assert_eq!(
        bridge.received()[1..],
        sent,
        "the bridge got every message exactly once"
    );
    assert_eq!(drops, 5);
    assert_eq!(
        bridge.sessions().len(),
        bridge_sockets,
        "resumed sessions keep their bridge socket"
    );
    assert!(watch.failures.is_empty(), "{:?}", watch.failures);
    lan.stop();
    bridge.stop();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_phone_that_starts_over_gets_a_bridge_socket_of_its_own() {
    let home = Home::new();
    let daemon = TestDaemon::start(&home, None, true).await;
    let bridge = BridgeStandIn::start(&home.bridge_socket());
    let lan = Forwarder::start(daemon.lan()).await;
    let phone = Phone::new();
    let Paired { session, record } = phone.pair(&daemon, vec![lan.route()], quick()).await;
    let mut first = Watch::new(session);
    first.connected_on(0, Route::Lan).await;
    first.round_trip("from the first launch").await;
    let sockets = bridge.sessions().len();
    let first_conn = first.bridge_statuses.last().expect("a bridge status").conn;
    // The app process is gone without a word, as a force-quit leaves it.
    drop(first);

    let session = Session::start(&phone.runtime, &phone.identity, record, options(quick()))
        .expect("the stored record starts");
    let mut second = Watch::new(session);
    let back = second.connected_on(0, Route::Lan).await;
    assert_eq!(
        resumed(&back),
        Some(false),
        "a new process has nothing to resume"
    );
    second
        .until("a new bridge socket, up", |watch| {
            watch
                .bridge_statuses
                .iter()
                .any(|status| status.state == BridgeState::Up && status.conn > first_conn)
        })
        .await;
    second.round_trip("from the second launch").await;
    assert_eq!(
        bridge.sessions().len(),
        sockets + 1,
        "the old process's socket, with its hello and views, is not the new one's"
    );
    lan.stop();
    bridge.stop();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_restarted_machine_is_reported_offline_then_resets_the_session() {
    let relay = TestRelay::start().await;
    let home = Home::new();
    let daemon = TestDaemon::start(&home, Some(&relay.url), false).await;
    let bridge = BridgeStandIn::start(&home.bridge_socket());
    await_identity(&relay, &daemon).await;
    let phone = Phone::new();
    let Paired { session, .. } = phone.pair(&daemon, Vec::new(), quick()).await;
    let mut watch = Watch::new(session);
    watch
        .until("the device's own relay session", |watch| {
            watch
                .statuses
                .iter()
                .any(|status| resumed(status) == Some(true))
        })
        .await;
    watch.round_trip("before").await;

    let mark = watch.mark();
    daemon.stop().await;
    let offline = watch
        .status_after(mark, "the machine offline", |status| {
            status.state == LinkState::Waiting(WaitReason::MachineOffline)
        })
        .await;
    assert_eq!(
        offline.route,
        Some(Route::Relay),
        "the relay socket stays open"
    );

    // What the app sends while the machine is away waits in the queue, and the machine that comes
    // back has no session to resume, so all of it is dropped and reported.
    for index in 0..3 {
        watch.send(&format!("queued {index}"));
    }
    let daemon = TestDaemon::start(&home, Some(&relay.url), false).await;
    let reset = watch
        .status_after(mark, "a reset session", session_reset)
        .await;
    assert_eq!(resumed(&reset), Some(false));
    watch
        .until("three reported messages", |watch| watch.failures.len() == 3)
        .await;
    let expected: Vec<_> = (0..3)
        .map(|index| (Some(format!("queued {index}")), SendFailure::SessionReset))
        .collect();
    assert_eq!(watch.failures, expected);
    watch.round_trip("after").await;
    assert!(!bridge
        .received()
        .iter()
        .any(|text| text.starts_with("queued")));
    bridge.stop();
    daemon.stop().await;
    relay.stop().await;
}
