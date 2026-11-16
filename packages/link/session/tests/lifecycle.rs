mod common;

use std::time::Duration;

use broski_link_session::{
    LinkState, Paired, Route, SendFailure, Session, Timings, WaitReason, OUTBOUND_QUEUE_MAX,
};
use broski_link_testkit::await_identity;
use broski_link_testkit::daemon::{Home, TestDaemon};
use broski_link_testkit::forwarder::Forwarder;
use broski_link_testkit::relay::TestRelay;
use common::bridge::BridgeStandIn;
use common::watch::{resumed, Watch, WAIT};
use common::{options, quick, Phone};
use serde_json::json;
use tokio::time::Instant;

struct Lan {
    daemon: TestDaemon,
    bridge: BridgeStandIn,
    lan: Forwarder,
    phone: Phone,
    _home: Home,
}

impl Lan {
    async fn start(timings: Timings) -> (Lan, Watch) {
        let home = Home::new();
        let daemon = TestDaemon::start(&home, None, true).await;
        let bridge = BridgeStandIn::start(&home.bridge_socket());
        let lan = Forwarder::start(daemon.lan()).await;
        let phone = Phone::new();
        let Paired { session, .. } = phone.pair(&daemon, vec![lan.route()], timings).await;
        let mut watch = Watch::new(session);
        watch.connected_on(0, Route::Lan).await;
        let rig = Lan {
            daemon,
            bridge,
            lan,
            phone,
            _home: home,
        };
        (rig, watch)
    }

    /// Waits until the daemon reports this phone's session attached, or detached.
    async fn attached(&self, attached: bool) {
        let device = self.phone.identity.id();
        let deadline = Instant::now() + WAIT;
        while self.daemon.session_attached(&device).await != Some(attached) {
            assert!(
                Instant::now() < deadline,
                "the daemon never saw attached = {attached}"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Drops the socket in use with new connections held, and returns once the redial is waiting
    /// at the forwarder.
    async fn hold_a_redial(&self) {
        let dialled = self.lan.accepted();
        self.lan.hold();
        self.lan.drop_connections();
        let deadline = Instant::now() + WAIT;
        while self.lan.accepted() == dialled {
            assert!(Instant::now() < deadline, "the phone never dialled again");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    async fn stop(self) {
        self.lan.stop();
        self.bridge.stop();
        self.daemon.stop().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_revoked_device_is_told_so_and_never_dials_again() {
    let (rig, mut watch) = Lan::start(quick()).await;
    watch.round_trip("before").await;
    let device = rig.phone.identity.id();
    let reply = rig
        .daemon
        .ask(json!({"cmd": "revoke", "device": &device[..8]}))
        .await;
    assert_eq!(reply["ok"], true);

    watch.end().await;
    let last = watch.statuses.last().expect("a status");
    assert_eq!(last.state, LinkState::Revoked);
    assert_eq!(last.close_code, Some(4003));
    assert!(watch.session.status().is_terminal());
    assert_eq!(
        watch.session.send_bridge(b"x".to_vec(), None),
        Err(SendFailure::Closed)
    );

    // The session has ended, so nothing the app does dials the machine again.
    let dialled = rig.lan.accepted();
    watch.session.network_changed();
    watch.session.resume();
    watch.session.lan_discovered(vec![rig.lan.route()]);
    assert!(watch.session.next_event().await.is_none());
    assert_eq!(rig.lan.accepted(), dialled);
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_device_revoked_over_the_relay_is_told_so_by_the_relay() {
    let relay = TestRelay::start().await;
    let home = Home::new();
    let daemon = TestDaemon::start(&home, Some(&relay.url), false).await;
    let bridge = BridgeStandIn::start(&home.bridge_socket());
    await_identity(&relay, &daemon).await;
    let phone = Phone::new();
    let Paired { session, record } = phone.pair(&daemon, Vec::new(), quick()).await;
    let mut watch = Watch::new(session);
    watch
        .until("the device's own relay session", |watch| {
            watch
                .statuses
                .iter()
                .any(|status| resumed(status) == Some(true))
        })
        .await;

    // The relay's own revoke, without the machine's CLOSE on the link: the device socket is
    // closed with 4003, the only word a phone gets when its session was not attached.
    let room = relay.hub.room(&record.id).expect("the machine's room");
    room.revoke_device(&phone.identity.id());
    watch.end().await;
    let last = watch.statuses.last().expect("a status");
    assert_eq!(last.state, LinkState::Revoked);
    assert_eq!(last.close_code, Some(4003));
    bridge.stop();
    daemon.stop().await;
    relay.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pausing_detaches_the_phone_and_resuming_resumes_the_session() {
    let (rig, mut watch) = Lan::start(quick()).await;
    rig.attached(true).await;

    let mark = watch.mark();
    watch.session.pause();
    let paused = watch
        .status_after(mark, "paused", |status| {
            status.state == LinkState::Waiting(WaitReason::Paused)
        })
        .await;
    assert_eq!(paused.route, None, "no socket is open while paused");
    // The machine sees the phone leave, which is what lets it push alerts again.
    rig.attached(false).await;
    watch.send("sent while paused");

    let mark = watch.mark();
    watch.session.resume();
    let back = watch.connected_on(mark, Route::Lan).await;
    assert_eq!(resumed(&back), Some(true));
    watch
        .until("the queued echo", |watch| {
            watch.bridge == ["echo:sent while paused"]
        })
        .await;
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_dial_in_flight_when_the_app_pauses_serves_a_quick_resume() {
    let (rig, mut watch) = Lan::start(quick()).await;
    watch.round_trip("everything acknowledged").await;
    let dialled = rig.lan.accepted();
    rig.hold_a_redial().await;
    let mark = watch.mark();
    watch.session.pause();
    watch
        .status_after(mark, "paused", |status| {
            status.state == LinkState::Waiting(WaitReason::Paused)
        })
        .await;
    rig.lan.release();

    let mark = watch.mark();
    watch.session.resume();
    let back = watch.connected_on(mark, Route::Lan).await;
    assert_eq!(resumed(&back), Some(true));
    assert_eq!(
        rig.lan.accepted(),
        dialled + 1,
        "the socket dialled before the pause was used"
    );
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_socket_older_than_the_stale_window_is_not_reused() {
    let timings = Timings {
        stale_socket: Duration::ZERO,
        ..quick()
    };
    let (rig, mut watch) = Lan::start(timings).await;
    watch.round_trip("everything acknowledged").await;
    let dialled = rig.lan.accepted();
    rig.hold_a_redial().await;
    let mark = watch.mark();
    watch.session.pause();
    watch
        .status_after(mark, "paused", |status| {
            status.state == LinkState::Waiting(WaitReason::Paused)
        })
        .await;
    rig.lan.release();

    let mark = watch.mark();
    watch.session.resume();
    watch.connected_on(mark, Route::Lan).await;
    assert_eq!(
        rig.lan.accepted(),
        dialled + 2,
        "the stale socket was replaced by a new dial"
    );
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_outbound_queue_refuses_past_its_bound_and_reports_what_it_drops() {
    let phone = Phone::new();
    let record = phone.record_nobody_serves();
    let session =
        Session::start(&phone.runtime, &phone.identity, record, options(quick())).expect("session");
    let mut watch = Watch::new(session);
    let big = vec![b'x'; OUTBOUND_QUEUE_MAX - 1];
    assert_eq!(watch.session.send_bridge(big, Some("big".into())), Ok(()));
    assert_eq!(
        watch.session.send_bridge(b"y".to_vec(), Some("one".into())),
        Ok(())
    );
    assert_eq!(
        watch.session.send_bridge(b"z".to_vec(), Some("two".into())),
        Err(SendFailure::QueueFull)
    );
    assert_eq!(
        watch
            .session
            .send_bridge(vec![0; OUTBOUND_QUEUE_MAX + 1], None),
        Err(SendFailure::TooLarge)
    );
    watch
        .status_after(0, "a scheduled retry", |status| {
            status.state == LinkState::Waiting(WaitReason::Retry)
        })
        .await;

    watch.session.close();
    watch.end().await;
    assert_eq!(
        watch.statuses.last().map(|status| status.state),
        Some(LinkState::Closed)
    );
    assert_eq!(
        watch.failures,
        [
            (Some("big".to_owned()), SendFailure::Closed),
            (Some("one".to_owned()), SendFailure::Closed)
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn closing_ends_the_session_on_the_machine_too() {
    let (rig, mut watch) = Lan::start(quick()).await;
    watch.round_trip("bye").await;
    let device = rig.phone.identity.id();
    watch.session.close();
    watch.end().await;
    assert_eq!(
        watch.statuses.last().map(|status| status.state),
        Some(LinkState::Closed)
    );
    let deadline = Instant::now() + WAIT;
    while rig.daemon.session_attached(&device).await.is_some() {
        assert!(
            Instant::now() < deadline,
            "the machine kept the closed session"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    rig.stop().await;
}
