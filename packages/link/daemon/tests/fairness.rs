mod common;

use std::time::Duration;

use common::daemon::{Options, TestDaemon};
use common::now_ms;
use common::scenario::pair_lan_phone;
use common::scripted::ScriptedBridge;

const KIB: usize = 1024;
/// What the bridge writes while the phone is flooding: enough that a starved bridge direction
/// cannot have moved most of it.
const FROM_BRIDGE: [usize; 64] = [8 * KIB; 64];
const FLOOD: usize = 400;
const FREEZE: Duration = Duration::from_millis(700);
const MOST: usize = 400 * KIB;

/// A phone that never stops sending must not starve the other direction: the bridge keeps being
/// read while the session's own command queue is full.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_bridge_direction_keeps_moving_while_the_phone_floods() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = ScriptedBridge::start(daemon.bridge_socket.clone()).await;
    bridge.stream(&FROM_BRIDGE);
    let mut phone = pair_lan_phone(&daemon).await;

    for _ in 0..FLOOD {
        phone
            .link
            .send(1, b"flood flood flood", now_ms())
            .expect("the phone queues its own burst");
    }
    phone.flush().await;
    tokio::time::sleep(FREEZE).await;

    let written = bridge.written();
    assert!(
        written >= MOST,
        "the bridge direction stalled at {written} bytes while the phone was sending"
    );

    bridge.stop();
    daemon.stop().await;
}
