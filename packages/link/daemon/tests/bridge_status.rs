mod common;

use std::path::PathBuf;
use std::time::Duration;

use common::daemon::{Options, TestDaemon};
use common::scenario::pair_lan_phone;
use common::scripted::ScriptedBridge;
use common::silent::SilentBridge;

const WAIT: Duration = Duration::from_secs(30);
const DIAL_TIMEOUT: Duration = Duration::from_secs(5);

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
            .await_dials("owner", 2, DIAL_TIMEOUT + Duration::from_secs(4))
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
