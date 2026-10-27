mod common;

use std::time::Duration;

use common::daemon::{Options, TestDaemon};
use common::now_ms;
use common::scenario::pair_lan_phone;
use common::scripted::ScriptedBridge;
use serde_json::json;

const WAIT: Duration = Duration::from_secs(30);
const IDLE: Duration = Duration::from_millis(300);

async fn start() -> (TestDaemon, ScriptedBridge) {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = ScriptedBridge::start(daemon.bridge_socket.clone()).await;
    (daemon, bridge)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn revoking_a_device_closes_its_session_with_4003() {
    let (daemon, bridge) = start().await;
    let mut phone = pair_lan_phone(&daemon).await;
    let device = phone.identity.public().id();

    let reply = daemon
        .ask(json!({"cmd": "revoke", "device": &device[..8]}))
        .await;
    assert_eq!(reply["ok"], json!(true));

    assert_eq!(phone.close_code(WAIT).await, Some(4003));
    bridge.stop();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn shutting_the_daemon_down_closes_the_session_with_4001() {
    let (daemon, bridge) = start().await;
    let mut phone = pair_lan_phone(&daemon).await;

    let stopped = tokio::spawn(async move { daemon.stop().await });
    assert_eq!(phone.close_code(WAIT).await, Some(4001));
    stopped.await.expect("the daemon stopped");
    bridge.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_phone_that_overruns_the_bridge_queue_is_closed_with_4002() {
    let (daemon, bridge) = start().await;
    let mut phone = pair_lan_phone(&daemon).await;

    // The bridge stops reading, so the daemon has nowhere to put what the phone keeps sending
    // until its queue for the bridge is past its 16 MiB bound. Bursts stay under the responder's
    // own command queue, so it is the bridge backlog that ends the session and not a lost link.
    bridge.stop_reading();
    let chunk = vec![b'x'; 256 * 1024];
    let mut sent = 0;
    'sending: while sent < 400 && phone.closed.is_empty() {
        for _ in 0..4 {
            if phone.link.send(1, &chunk, now_ms()).is_err() {
                break 'sending;
            }
            phone.flush().await;
            sent += 1;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
        phone.step().await;
    }

    assert_eq!(phone.close_code(WAIT).await, Some(4002));
    bridge.stop();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_session_with_no_phone_expires_and_the_next_phone_starts_a_new_one() {
    let daemon = TestDaemon::start(Options {
        durations: broski_link_daemon::durations::Durations {
            session_idle: IDLE,
            ..Default::default()
        },
        ..Options::default()
    })
    .await;
    let bridge = ScriptedBridge::start(daemon.bridge_socket.clone()).await;
    let mut phone = pair_lan_phone(&daemon).await;
    let session = phone.session_id().expect("a session exists");

    phone.disconnect().await;
    tokio::time::sleep(IDLE * 4).await;

    assert_eq!(
        phone.connect_lan(daemon.lan(), WAIT).await,
        Some(false),
        "the expired session was resumed instead of replaced"
    );
    assert_ne!(phone.session_id(), Some(session));
    bridge.stop();
    daemon.stop().await;
}
