//! What the phone-side crates' integration tests run against: the real daemon and the real relay
//! in-process on loopback, and a LAN path in front of the daemon that delays, holds, cuts and drops
//! connections. Nothing here is a stand-in for the machine.

pub mod daemon;
pub mod forwarder;
pub mod relay;

use std::time::Duration;

use serde_json::json;
use tokio::time::Instant;

use self::daemon::TestDaemon;
use self::relay::TestRelay;

/// How long any wait of a test may take before it fails naming what it waited for.
pub const WAIT: Duration = Duration::from_secs(20);

/// A phone that only has the offer fetches the machine's identity from the relay, which has it
/// once the daemon's relay socket published it.
pub async fn await_identity(relay: &TestRelay, daemon: &TestDaemon) {
    let status = daemon.ask(json!({"cmd": "status"})).await;
    let machine = status["machine"]["id"]
        .as_str()
        .expect("machine id")
        .to_owned();
    let deadline = Instant::now() + WAIT;
    while relay
        .hub
        .db()
        .identity(&machine)
        .await
        .ok()
        .flatten()
        .is_none()
    {
        assert!(
            Instant::now() < deadline,
            "the machine never published its identity"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
