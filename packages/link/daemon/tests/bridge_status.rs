mod common;

use std::path::PathBuf;
use std::time::Duration;

use common::bridge::FakeBridge;
use common::daemon::{Options, TestDaemon};
use common::scenario::{pair_lan_phone, quick_durations, POLL};
use common::scripted::ScriptedBridge;
use common::silent::SilentBridge;

const WAIT: Duration = Duration::from_secs(30);
const DIAL_TIMEOUT: Duration = Duration::from_millis(300);

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_dead_session_socket_is_not_hidden_by_the_feed() {
    let home = tempfile::tempdir().expect("temp dir");
    let socket = home.path().join("bridge.sock");
    // Listening before the daemon starts, so its own feed socket is counted from the first dial.
    let bridge = ScriptedBridge::start(socket.clone()).await;
    let daemon = TestDaemon::start(Options {
        bridge_socket: Some(socket),
        ..Options::default()
    })
    .await;
    let mut phone = pair_lan_phone(&daemon).await;

    phone
        .bridge_messages(WAIT, |status| status["state"] == "up")
        .await;
    assert_eq!(daemon.bridge_state().await, "up");

    // The session's own socket goes for good while the daemon's feed socket keeps the process-wide
    // state at up: the phone must still be told this session has nothing to talk to.
    bridge.kill_session();
    bridge.refuse_sessions();

    let statuses = phone
        .bridge_messages(WAIT, |status| status["state"] != "up")
        .await;
    let last = statuses.last().expect("a bridge status");
    assert_eq!(last["state"], "connecting");
    assert_eq!(last["conn"], 1, "the socket count did not move");
    assert_eq!(
        daemon.bridge_state().await,
        "up",
        "the aggregate never noticed, which is why the session reports its own socket"
    );

    bridge.stop();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_bridge_that_never_answers_the_upgrade_is_redialled_after_the_dial_timeout() {
    let dir = tempfile::tempdir().expect("temp dir");
    let socket: PathBuf = dir.path().join("bridge.sock");
    let bridge = SilentBridge::start(socket.clone()).await;
    let daemon = TestDaemon::start(Options {
        bridge_socket: Some(socket),
        durations: broski_link_daemon::durations::Durations {
            dial_timeout: DIAL_TIMEOUT,
            ..quick_durations()
        },
        ..Options::default()
    })
    .await;
    let mut phone = pair_lan_phone(&daemon).await;

    let down = phone
        .bridge_messages(WAIT, |status| status["state"] == "down")
        .await;
    assert!(
        bridge.await_dials("owner", 1, DIAL_TIMEOUT).await,
        "the session never dialled the bridge"
    );
    assert!(
        bridge
            .await_dials("owner", 2, DIAL_TIMEOUT + Duration::from_secs(2))
            .await,
        "the dial never timed out, so the session never tried again"
    );
    assert_eq!(
        down.last().expect("a bridge status")["conn"],
        0,
        "no socket came up, so the count never moved"
    );

    bridge.stop();
    daemon.stop().await;
}

/// An unsupervised bridge that goes away for less than a redial is not reported `down`: the feed
/// sockets come back before anyone could have acted on it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_bridge_that_comes_back_within_the_redial_never_reads_as_down() {
    let home = tempfile::tempdir().expect("temp dir");
    let socket = home.path().join("bridge.sock");
    let bridge = FakeBridge::start(socket.clone()).await;
    let daemon = TestDaemon::start(Options {
        bridge_socket: Some(socket.clone()),
        durations: quick_durations(),
        ..Options::default()
    })
    .await;
    let deadline = tokio::time::Instant::now() + WAIT;
    while daemon.bridge_state().await != "up" {
        assert!(
            tokio::time::Instant::now() < deadline,
            "the daemon never reported the bridge up"
        );
        tokio::time::sleep(POLL).await;
    }

    bridge.stop().await;
    let seen = tokio::time::timeout(Duration::from_millis(300), async {
        loop {
            if daemon.bridge_state().await == "down" {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or(false);
    assert!(
        !seen,
        "the bridge read as down while its feed socket was being redialled"
    );

    let again = FakeBridge::start(socket).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(daemon.bridge_state().await, "up");
    again.stop().await;
    daemon.stop().await;
}
