mod common;

use std::time::Duration;

use broski_link_session::{MachineRecord, Paired, Route, Session, Timings};
use common::bridge::BridgeStandIn;
use common::daemon::{Home, TestDaemon};
use common::forwarder::Forwarder;
use common::relay::TestRelay;
use common::watch::{resumed, Watch};
use common::{options, quick, Phone};
use tokio::time::Instant;

/// A daemon reachable over the relay and, through a forwarder the test controls, over the LAN,
/// with a phone paired to it over that LAN path.
struct Rig {
    relay: TestRelay,
    daemon: TestDaemon,
    bridge: BridgeStandIn,
    lan: Forwarder,
    phone: Phone,
    record: MachineRecord,
    _home: Home,
}

impl Rig {
    async fn start() -> (Rig, Session) {
        let relay = TestRelay::start().await;
        let home = Home::new();
        let daemon = TestDaemon::start(&home, Some(&relay.url), true).await;
        let bridge = BridgeStandIn::start(&home.bridge_socket());
        let lan = Forwarder::start(daemon.lan()).await;
        let phone = Phone::new();
        let Paired { session, record } = phone.pair(&daemon, vec![lan.route()], quick()).await;
        let rig = Rig {
            relay,
            daemon,
            bridge,
            lan,
            phone,
            record,
            _home: home,
        };
        (rig, session)
    }

    /// The paired record restricted to the forwarder's LAN route and the relay, so the routes the
    /// daemon reports for the host's own interfaces never take part.
    fn session(&self, timings: Timings) -> Watch {
        let mut record = self.record.clone();
        record.lan = vec![self.lan.route()];
        let session = Session::start(
            &self.phone.runtime,
            &self.phone.identity,
            record,
            options(timings),
        )
        .expect("session");
        Watch::new(session)
    }

    async fn stop(self) {
        self.lan.stop();
        self.bridge.stop();
        self.daemon.stop().await;
        self.relay.stop().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_lan_socket_wins_over_the_relay_only_inside_the_grace_window() {
    let (rig, paired) = Rig::start().await;
    drop(paired);
    // The relay socket opens at once; the LAN one after 150 ms, inside the 300 ms window.
    rig.lan.delay(Duration::from_millis(150));
    let mut watch = rig.session(quick());
    let connected = watch.connected_after(0).await;
    assert_eq!(connected.route, Some(Route::Lan));
    assert_eq!(connected.route_detail, Some(rig.lan.route()));
    watch.round_trip("lan").await;
    drop(watch);

    // The same LAN socket at 900 ms is too late: the relay has carried the link since 300 ms.
    rig.lan.delay(Duration::from_millis(900));
    let mut watch = rig.session(quick());
    let connected = watch.connected_after(0).await;
    assert_eq!(connected.route, Some(Route::Relay));
    watch.round_trip("relay").await;
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_lan_candidate_that_never_answers_loses_to_the_relay_once_the_grace_is_over() {
    let (rig, paired) = Rig::start().await;
    drop(paired);
    rig.lan.hold();
    let timings = Timings {
        lan_dial_timeout: Duration::from_secs(60),
        ..quick()
    };
    let started = Instant::now();
    let mut watch = rig.session(timings);
    let connected = watch.connected_after(0).await;
    assert_eq!(connected.route, Some(Route::Relay));
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "the relay waited for the LAN dial instead of the grace window: {:?}",
        started.elapsed()
    );
    watch.round_trip("relay").await;
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_link_moves_to_the_relay_when_the_lan_goes_and_back_when_it_returns() {
    let (rig, paired) = Rig::start().await;
    drop(paired);
    let mut watch = rig.session(quick());
    watch.connected_on(0, Route::Lan).await;
    for index in 0..20 {
        watch.round_trip(&format!("before {index}")).await;
    }
    let bridge_sockets = rig.bridge.sessions().len();

    let mark = watch.mark();
    rig.lan.cut();
    for index in 0..20 {
        watch.send(&format!("after {index}"));
    }
    let relay = watch.connected_on(mark, Route::Relay).await;
    assert_eq!(resumed(&relay), Some(true), "the session survived the move");
    watch.echoes(40).await;
    let expected: Vec<String> = (0..20)
        .map(|index| format!("echo:before {index}"))
        .chain((0..20).map(|index| format!("echo:after {index}")))
        .collect();
    assert_eq!(
        watch.bridge, expected,
        "nothing lost, nothing twice, in order"
    );

    let mark = watch.mark();
    rig.lan.release();
    let lan = watch.connected_on(mark, Route::Lan).await;
    assert_eq!(
        resumed(&lan),
        Some(true),
        "the probe took the LAN back without a new session"
    );
    assert_eq!(lan.route_detail, Some(rig.lan.route()));
    watch.round_trip("home").await;
    assert_eq!(
        rig.bridge.sessions().len(),
        bridge_sockets,
        "the session kept its bridge socket across both moves"
    );
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_relay_link_takes_a_lan_route_the_platform_discovers() {
    let (rig, paired) = Rig::start().await;
    drop(paired);
    let mut record = rig.record.clone();
    record.lan = Vec::new();
    let session = Session::start(
        &rig.phone.runtime,
        &rig.phone.identity,
        record,
        options(quick()),
    )
    .expect("session");
    let mut watch = Watch::new(session);
    watch.connected_on(0, Route::Relay).await;

    let mark = watch.mark();
    watch.session.lan_discovered(vec![rig.lan.route()]);
    let lan = watch.connected_on(mark, Route::Lan).await;
    assert_eq!(resumed(&lan), Some(true));
    watch
        .until("the record with the discovered route", |watch| {
            watch
                .records
                .last()
                .is_some_and(|record| record.lan.contains(&rig.lan.route()))
        })
        .await;
    watch.round_trip("found").await;
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_lan_route_that_answers_for_another_machine_leaves_the_relay_link_alone() {
    let (rig, paired) = Rig::start().await;
    drop(paired);
    let stranger_home = Home::new();
    let stranger = TestDaemon::start(&stranger_home, None, true).await;
    let wrong = Forwarder::start(stranger.lan()).await;
    let timings = Timings {
        probe_interval: Duration::from_secs(60),
        ..quick()
    };
    let mut record = rig.record.clone();
    record.lan = Vec::new();
    let session = Session::start(
        &rig.phone.runtime,
        &rig.phone.identity,
        record,
        options(timings),
    )
    .expect("session");
    let mut watch = Watch::new(session);
    watch.connected_on(0, Route::Relay).await;

    // The advertised address opens, but the machine behind it cannot answer this phone's msg1.
    let mark = watch.mark();
    watch.session.lan_discovered(vec![wrong.route()]);
    let deadline = Instant::now() + common::watch::WAIT;
    while wrong.accepted() == 0 {
        assert!(
            Instant::now() < deadline,
            "the probe never dialled the route"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    watch.round_trip("during the attempt").await;
    // Absence needs a window: a probe pulled forward again would redial at once, many times over.
    tokio::time::sleep(Duration::from_secs(1)).await;
    watch.round_trip("after the attempt").await;
    assert_eq!(
        wrong.accepted(),
        1,
        "the failed route waits out the probe interval"
    );
    assert_eq!(
        watch.statuses[mark..],
        [],
        "the relay carried the session throughout"
    );
    wrong.stop();
    stranger.stop().await;
    rig.stop().await;
}
