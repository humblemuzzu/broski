mod common;

use std::time::Duration;

use common::daemon::{Options, TestDaemon};
use common::scenario::pair_lan_phone;
use common::scripted::{payload, ScriptedBridge};

const WAIT: Duration = Duration::from_secs(120);
const MIB: usize = 1024 * 1024;
/// Everything the daemon may hold for a bridge that keeps writing while no ack comes back: the
/// 16 MiB unacked window, the one message waiting for it, the read-ahead and the socket buffers.
const READ_AHEAD_BOUND: usize = 32 * MIB;
const FREEZE: Duration = Duration::from_millis(500);
const STEP: Duration = Duration::from_millis(20);

/// 48 MiB across 30 messages, mixed sizes up to the 8 MiB a single bridge message may be.
fn bulk() -> Vec<usize> {
    let mut sizes = vec![8 * MIB, 6 * MIB, 4 * MIB, 4 * MIB];
    sizes.extend_from_slice(&[MIB; 26]);
    sizes
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_phone_that_reads_slowly_costs_backpressure_not_the_session() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = ScriptedBridge::start(daemon.bridge_socket.clone()).await;
    let sizes = bulk();
    bridge.stream(&sizes);
    let mut phone = pair_lan_phone(&daemon).await;

    // No reading, no acks at all: the session must stop reading the bridge rather than end.
    tokio::time::sleep(FREEZE).await;
    let early = bridge.written();
    let stalled = bridge.stalled_for();
    assert!(
        early <= READ_AHEAD_BOUND,
        "the daemon read {early} bytes ahead of a phone that took none"
    );
    let longest = bridge
        .sent()
        .iter()
        .map(|sent| sent.took)
        .max()
        .unwrap_or_default();
    assert!(
        longest >= FREEZE / 2 || stalled.is_some_and(|wait| wait >= FREEZE / 2),
        "the bridge was never blocked ({early} written, longest write {longest:?}, in flight {stalled:?})"
    );

    let mut received = 0;
    while received < sizes.len() {
        let (stream, bytes) = phone.next_message(WAIT).await;
        assert_eq!(stream, 1);
        assert_eq!(
            bytes,
            payload(received, sizes[received]),
            "message {received} did not arrive as it was sent"
        );
        received += 1;
        tokio::time::sleep(STEP).await;
    }
    assert!(
        phone.messages.is_empty(),
        "the phone was sent more messages than the bridge wrote"
    );
    assert!(
        phone.closed.is_empty(),
        "the session was closed: {:?}",
        phone.closed
    );
    assert!(
        !bridge.closed_by_daemon(),
        "the daemon dropped the bridge socket instead of slowing down"
    );
    let written: usize = bridge.sent().iter().map(|sent| sent.len).sum();
    assert_eq!(
        written,
        sizes.iter().sum::<usize>(),
        "the bridge never wrote it all"
    );

    phone.send(1, b"after the bulk").await;
    let deadline = tokio::time::Instant::now() + WAIT;
    while !bridge
        .received()
        .iter()
        .any(|text| text == "after the bulk")
    {
        assert!(
            tokio::time::Instant::now() < deadline,
            "the session stopped forwarding after the bulk"
        );
        tokio::time::sleep(STEP).await;
    }

    bridge.stop();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_bridge_socket_that_dies_keeps_every_request_and_names_the_new_one() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = ScriptedBridge::start(daemon.bridge_socket.clone()).await;
    let mut phone = pair_lan_phone(&daemon).await;

    // The bridge stops reading, so the requests pile up in the daemon's queue ...
    bridge.stop_reading();
    let requests: Vec<String> = (0..20)
        .map(|index| format!("request-{index:02}|{}", "x".repeat(200 * 1024)))
        .collect();
    for request in &requests {
        phone.send(1, request.as_bytes()).await;
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    // ... and then the socket dies under them.
    bridge.kill_session();

    let deadline = tokio::time::Instant::now() + WAIT;
    while bridge.received().len() < requests.len() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "the bridge saw {} of {} requests after the reset",
            bridge.received().len(),
            requests.len()
        );
        tokio::time::sleep(STEP).await;
    }
    assert_eq!(
        bridge.received(),
        requests,
        "a request was lost or reordered across the reset"
    );
    assert!(bridge.dials() >= 2, "the bridge was never redialled");

    let statuses = phone
        .bridge_messages(WAIT, |status| {
            status["state"] == "up" && status["conn"] == 2
        })
        .await;
    assert!(
        statuses.iter().any(|status| status["state"] != "up"),
        "the phone was never told this session's socket went away: {statuses:?}"
    );

    bridge.stop();
    daemon.stop().await;
}
