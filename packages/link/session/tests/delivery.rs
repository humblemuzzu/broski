//! A pause lets what the phone already sent reach the machine first.

mod common;

use std::time::Duration;

use broski_link_session::{LinkState, Paired, Route, Timings, WaitReason};
use broski_link_testkit::daemon::{Home, TestDaemon};
use broski_link_testkit::forwarder::Forwarder;
use common::bridge::BridgeStandIn;
use common::watch::{resumed, Watch, WAIT};
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

    async fn received(&self, text: &str) {
        let deadline = Instant::now() + WAIT;
        while !self.bridge.received().iter().any(|got| got == text) {
            assert!(Instant::now() < deadline, "the bridge never got {text:?}");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    async fn stop(self) {
        self.lan.stop();
        self.bridge.stop();
        self.daemon.stop().await;
    }
}

fn paused(status: &broski_link_session::Status) -> bool {
    status.state == LinkState::Waiting(WaitReason::Paused)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_message_sent_as_the_app_leaves_reaches_the_machine_before_the_pause() {
    let (rig, mut watch) = Rig::start(quick()).await;
    let mark = watch.mark();

    watch.send("sent as the app left");
    watch.session.pause();
    watch.status_after(mark, "paused", paused).await;

    assert!(
        rig.bridge
            .received()
            .contains(&"sent as the app left".to_owned()),
        "the machine had it before the socket closed: {:?}",
        rig.bridge.received()
    );
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_link_that_died_as_the_app_left_is_dialled_again_to_deliver_before_the_pause() {
    let timings = Timings {
        ping_idle: Duration::from_millis(200),
        dead_after: Duration::from_millis(800),
        pause_grace: Duration::from_secs(10),
        ..quick()
    };
    let (rig, mut watch) = Rig::start(timings).await;
    rig.lan.stall();
    let mark = watch.mark();

    watch.send("sent into a dead socket as the app left");
    watch.session.pause();
    let back = watch.connected_on(mark, Route::Lan).await;
    assert_eq!(resumed(&back), Some(true));
    rig.received("sent into a dead socket as the app left")
        .await;
    watch.status_after(mark, "paused", paused).await;
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_machine_out_of_reach_holds_the_pause_only_for_the_grace_then_delivers_on_resume() {
    let timings = Timings {
        pause_grace: Duration::from_millis(700),
        ..quick()
    };
    let (rig, mut watch) = Rig::start(timings).await;
    rig.lan.cut();
    let mark = watch.mark();
    let left = Instant::now();

    watch.send("held while out of reach");
    watch.session.pause();
    watch.status_after(mark, "paused", paused).await;
    assert!(
        left.elapsed() < Duration::from_secs(3),
        "the pause waited {:?}",
        left.elapsed()
    );

    rig.lan.release();
    let mark = watch.mark();
    watch.session.resume();
    watch.connected_on(mark, Route::Lan).await;
    rig.received("held while out of reach").await;
    rig.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn coming_back_while_a_pause_waits_on_delivery_keeps_the_link() {
    let timings = Timings {
        pause_grace: Duration::from_secs(10),
        ..quick()
    };
    let (rig, mut watch) = Rig::start(timings).await;
    let dialled = rig.lan.accepted();
    rig.lan.stall();
    let mark = watch.mark();

    watch.send("waiting on delivery");
    watch.session.pause();
    watch.session.resume();
    tokio::time::sleep(Duration::from_millis(300)).await;
    rig.lan.drop_connections();
    watch.connected_on(mark, Route::Lan).await;
    rig.received("waiting on delivery").await;

    assert!(
        !watch.statuses[mark..].iter().any(paused),
        "the app came back before the pause happened: {:?}",
        &watch.statuses[mark..]
    );
    assert_eq!(rig.lan.accepted(), dialled + 1);
    rig.stop().await;
}
