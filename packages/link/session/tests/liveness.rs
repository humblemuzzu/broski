//! How fast a phone notices that its connection died without a word, and that a network change
//! leaves a connection that still works alone.

mod common;

use std::time::Duration;

use broski_link_session::{LinkState, Paired, Route, Timings};
use broski_link_testkit::daemon::{Home, TestDaemon};
use broski_link_testkit::forwarder::Forwarder;
use common::bridge::BridgeStandIn;
use common::watch::{resumed, Watch};
use common::{quick, Phone};
use tokio::time::Instant;

struct Rig {
    daemon: TestDaemon,
    bridge: BridgeStandIn,
    lan: Forwarder,
    _phone: Phone,
    _home: Home,
}

impl Rig {
    async fn start(timings: Timings) -> (Rig, Watch) {
        let home = Home::new();
        let daemon = TestDaemon::start(&home, None, true).await;
        let bridge = BridgeStandIn::start(&home.bridge_socket());
        let lan = Forwarder::start(daemon.lan()).await;
        let phone = Phone::new();
        let Paired { session, .. } = phone.pair(&daemon, vec![lan.route()], timings).await;
        let mut watch = Watch::new(session);
        watch.connected_on(0, Route::Lan).await;
        watch.round_trip("first").await;
        let rig = Rig {
            daemon,
            bridge,
            lan,
            _phone: phone,
            _home: home,
        };
        (rig, watch)
    }

    async fn stop(self) {
        self.lan.stop();
        self.bridge.stop();
        self.daemon.stop().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_network_change_keeps_a_link_that_still_answers() {
    let (rig, mut watch) = Rig::start(quick()).await;
    let dialled = rig.lan.accepted();
    let mark = watch.mark();

    watch.session.network_changed();
    watch.round_trip("after the change").await;
    tokio::time::sleep(quick().network_probe + Duration::from_millis(500)).await;
    watch.round_trip("after the probe window").await;

    assert_eq!(rig.lan.accepted(), dialled, "no new socket");
    assert!(
        watch.statuses[mark..]
            .iter()
            .all(|status| matches!(status.state, LinkState::Connected { .. })),
        "the link never left Connected: {:?}",
        &watch.statuses[mark..]
    );
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_network_change_over_a_silently_dead_link_dials_again_within_the_probe_window() {
    let timings = Timings {
        network_probe: Duration::from_millis(800),
        ..quick()
    };
    let (rig, mut watch) = Rig::start(timings).await;
    let dialled = rig.lan.accepted();
    rig.lan.stall();
    watch.send("sent into the dead socket");
    let mark = watch.mark();
    let changed = Instant::now();

    watch.session.network_changed();
    let back = watch.connected_on(mark, Route::Lan).await;

    assert_eq!(resumed(&back), Some(true));
    assert!(
        changed.elapsed() < Duration::from_secs(3),
        "the dead link was noticed after {:?}",
        changed.elapsed()
    );
    assert_eq!(rig.lan.accepted(), dialled + 1);
    watch
        .until("the echo, resent on the new socket", |watch| {
            watch
                .bridge
                .contains(&"echo:sent into the dead socket".to_owned())
        })
        .await;
    assert_eq!(
        rig.bridge.received(),
        ["first", "sent into the dead socket"],
        "delivered once"
    );
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_link_that_goes_silent_is_dialled_again_after_dead_after() {
    let timings = Timings {
        ping_idle: Duration::from_millis(200),
        dead_after: Duration::from_millis(1000),
        ..quick()
    };
    let (rig, mut watch) = Rig::start(timings).await;
    let mark = watch.mark();
    let stalled = Instant::now();

    rig.lan.stall();
    let back = watch.connected_on(mark, Route::Lan).await;

    assert_eq!(resumed(&back), Some(true));
    let noticed = stalled.elapsed();
    assert!(
        noticed >= Duration::from_millis(900) && noticed < Duration::from_secs(4),
        "noticed after {noticed:?}"
    );
    watch.round_trip("on the new socket").await;
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_idle_link_that_still_works_is_never_taken_for_dead() {
    let timings = Timings {
        ping_idle: Duration::from_millis(200),
        dead_after: Duration::from_millis(1000),
        ..quick()
    };
    let (rig, mut watch) = Rig::start(timings).await;
    let dialled = rig.lan.accepted();

    tokio::time::sleep(Duration::from_secs(4)).await;
    watch.round_trip("after four quiet seconds").await;

    assert_eq!(rig.lan.accepted(), dialled, "the pings kept it alive");
    rig.stop().await;
}
