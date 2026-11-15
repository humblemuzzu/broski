mod common;

use std::time::Duration;

use broski_link_session::{LinkState, Paired, Timings, WaitReason};
use broski_relay::auth::sha256;
use common::bridge::BridgeStandIn;
use common::daemon::{Home, TestDaemon};
use common::relay::TestRelay;
use common::watch::{resumed, Watch};
use common::{await_identity, quick, Phone};
use serde_json::json;
use tokio::time::{sleep, Instant};

/// A phone paired through the relay and parked: the session has no socket while the relay's and
/// the daemon's records of the device are changed.
struct Parked {
    relay: TestRelay,
    daemon: TestDaemon,
    bridge: BridgeStandIn,
    phone: Phone,
    device: String,
    machine: String,
    token: String,
    watch: Watch,
    _home: Home,
}

impl Parked {
    async fn start(window: Duration) -> Parked {
        let relay = TestRelay::start().await;
        let home = Home::new();
        let daemon = TestDaemon::start(&home, Some(&relay.url), false).await;
        let bridge = BridgeStandIn::start(&home.bridge_socket());
        await_identity(&relay, &daemon).await;
        let phone = Phone::new();
        let timings = Timings {
            relay_refusal_window: window,
            ..quick()
        };
        let Paired { session, record } = phone.pair(&daemon, Vec::new(), timings).await;
        let mut watch = Watch::new(session);
        watch
            .until("the device's own relay session", |watch| {
                watch
                    .statuses
                    .iter()
                    .any(|status| resumed(status) == Some(true))
            })
            .await;
        let mark = watch.mark();
        watch.session.pause();
        watch
            .status_after(mark, "paused", |status| {
                status.state == LinkState::Waiting(WaitReason::Paused)
            })
            .await;
        Parked {
            device: phone.identity.id(),
            machine: record.id,
            token: record.relay_token.expect("a relay token"),
            relay,
            daemon,
            bridge,
            phone,
            watch,
            _home: home,
        }
    }

    async fn relay_knows_device(&self) -> bool {
        let hash = sha256(self.token.as_bytes());
        let known = self
            .relay
            .hub
            .db()
            .authorize_device(&self.machine, &self.device, &hash)
            .await
            .expect("the relay's database");
        known.is_some()
    }

    async fn until_relay_knows(&self, known: bool) {
        let deadline = Instant::now() + common::watch::WAIT;
        while self.relay_knows_device().await != known {
            assert!(
                Instant::now() < deadline,
                "the relay never reached known={known}"
            );
            sleep(Duration::from_millis(20)).await;
        }
    }

    async fn stop(self) {
        drop(self.watch);
        self.bridge.stop();
        self.daemon.stop().await;
        self.relay.stop().await;
        drop(self.phone);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_device_revoked_while_it_has_no_socket_ends_revoked_once_the_relay_keeps_refusing_it() {
    let mut parked = Parked::start(Duration::from_secs(1)).await;
    let reply = parked
        .daemon
        .ask(json!({"cmd": "revoke", "device": &parked.device[..8]}))
        .await;
    assert_eq!(reply["ok"], true);
    parked.until_relay_knows(false).await;

    let mark = parked.watch.mark();
    parked.watch.session.resume();
    parked
        .watch
        .status_after(mark, "the relay's refusal", |status| {
            status.state == LinkState::Waiting(WaitReason::RelayRefused)
        })
        .await;
    parked.watch.end().await;
    let last = parked.watch.statuses.last().expect("a status");
    assert_eq!(last.state, LinkState::Revoked);
    assert!(parked.watch.session.status().is_terminal());
    parked.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_token_the_relay_has_not_been_told_of_yet_is_retried_and_never_revoked() {
    let mut parked = Parked::start(Duration::from_secs(30)).await;
    // What the relay holds right after a pairing, before the daemon's asynchronous refresh
    // reached it.
    parked
        .relay
        .hub
        .db()
        .delete_device(&parked.machine, &parked.device)
        .await
        .expect("the device leaves the relay");
    parked.until_relay_knows(false).await;

    let mark = parked.watch.mark();
    parked.watch.session.resume();
    let refused = |watch: &Watch| {
        watch
            .statuses
            .iter()
            .skip(mark)
            .filter(|status| status.state == LinkState::Waiting(WaitReason::RelayRefused))
            .count()
    };
    parked
        .watch
        .until("six refusals in a row", |watch| refused(watch) >= 6)
        .await;

    let hash = sha256(parked.token.as_bytes());
    parked
        .relay
        .hub
        .db()
        .put_device(&parked.machine, &parked.device, &hash, 1)
        .await
        .expect("the daemon's refresh reaches the relay");
    parked
        .watch
        .status_after(
            mark,
            "a connection once the relay knows the device",
            |status| matches!(status.state, LinkState::Connected { .. }),
        )
        .await;
    assert!(
        parked
            .watch
            .statuses
            .iter()
            .all(|status| status.state != LinkState::Revoked),
        "{:?}",
        parked.watch.statuses
    );
    parked.stop().await;
}
