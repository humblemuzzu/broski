mod common;

use std::time::Duration;

use common::daemon::{Options, TestDaemon};
use common::scenario::pair_lan_phone;
use common::scripted::{payload, ScriptedBridge};

const WAIT: Duration = Duration::from_secs(120);
const FREEZE: Duration = Duration::from_millis(50);
/// The phone reads one frame per step, so this is as much as the test phone can take in inside the
/// window the session keeps a closing connection open.
const COUNT: usize = 20;
const SIZE: usize = 1024;

/// The phone stops reading, the connection's out queue fills, and then the device is revoked: the
/// close code still has to reach it, which is the whole point of the code.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_close_frame_reaches_a_phone_whose_out_queue_is_full() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = ScriptedBridge::start(daemon.bridge_socket.clone()).await;
    bridge.stream(&[SIZE; COUNT]);
    let mut phone = pair_lan_phone(&daemon).await;

    tokio::time::sleep(FREEZE).await;
    let device = phone.identity.public().id();
    let reply = daemon
        .ask(serde_json::json!({"cmd": "revoke", "device": device[..8]}))
        .await;
    assert_eq!(reply["device"], device);

    let code = phone.close_code(WAIT).await;
    assert_eq!(
        code,
        Some(4003),
        "the phone was never told why the session ended"
    );

    // What the session had already handed over arrived before the close, in order.
    let mut received = 0;
    while !phone.messages.is_empty() {
        let (stream, bytes) = phone.messages.remove(0);
        assert_eq!(stream, 1);
        assert_eq!(
            bytes,
            payload(received, SIZE),
            "message {received} did not arrive as it was sent"
        );
        received += 1;
        assert!(
            received <= COUNT,
            "the phone was sent more than it was owed"
        );
    }
    assert!(received > 0, "no bridge message was delivered");

    bridge.stop();
    daemon.stop().await;
}
