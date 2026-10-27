mod common;

use std::time::{Duration, Instant};

use broski_link_core::{Link, CONFIG};
use common::daemon::{Options, TestDaemon};
use common::scenario::pair_lan_phone;
use common::scripted::ScriptedBridge;
use serde_json::json;

const WAIT: Duration = Duration::from_secs(30);
const MIB: usize = 1024 * 1024;
const POLL: Duration = Duration::from_millis(10);

/// Waits for [ready] instead of for a duration: every assertion below is about an outcome, not a
/// moment.
async fn until(what: &str, mut ready: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !ready() {
        assert!(Instant::now() < deadline, "{what} never happened");
        tokio::time::sleep(POLL).await;
    }
}

fn requests(from: usize, to: usize, size: usize) -> Vec<String> {
    (from..to)
        .map(|index| format!("request-{index:02}|{}", "x".repeat(size)))
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_bridge_socket_that_dies_while_the_phone_sends_loses_nothing() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = ScriptedBridge::start(daemon.bridge_socket.clone()).await;
    // The bridge keeps the phone's direction busy, so the session is under load in both
    // directions when its socket dies: the window the hand-back has to survive.
    bridge.stream(&[MIB; 4]);
    let mut phone = pair_lan_phone(&daemon).await;
    phone.next_message(WAIT).await;

    let before = requests(0, 20, 128 * 1024);
    for request in &before {
        phone.send(1, request.as_bytes()).await;
    }
    bridge.kill_session();
    let after = requests(20, 40, 128 * 1024);
    for request in &after {
        phone.send(1, request.as_bytes()).await;
    }

    until("the bridge never saw every request", || {
        bridge.received().len() >= before.len() + after.len()
    })
    .await;
    let mut expected = before;
    expected.extend(after);
    assert_eq!(
        bridge.received(),
        expected,
        "a request was lost or reordered across the reset"
    );

    bridge.stop();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_rename_hands_back_what_the_old_socket_never_wrote() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = ScriptedBridge::start(daemon.bridge_socket.clone()).await;
    let mut phone = pair_lan_phone(&daemon).await;
    phone
        .bridge_messages(WAIT, |status| status["state"] == "up")
        .await;

    // Nothing is drained, so the requests sit in what the old socket was given and never wrote.
    bridge.stop_reading();
    let queued = requests(0, 8, 128 * 1024);
    for request in &queued {
        phone.send(1, request.as_bytes()).await;
    }
    phone
        .send_control(json!({"t": "hello", "name": "Renamed Phone", "platform": "ios"}))
        .await;

    // The rename drops the old socket; the next one reads again.
    bridge.kill_session();
    until("the bridge never saw what the rename handed back", || {
        bridge.received().len() >= queued.len()
    })
    .await;
    assert_eq!(
        bridge.received(),
        queued,
        "a rename lost or reordered what the phone had already sent"
    );

    bridge.stop();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_fresh_session_never_sees_what_the_old_one_never_delivered() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = ScriptedBridge::start(daemon.bridge_socket.clone()).await;
    let mut phone = pair_lan_phone(&daemon).await;
    phone
        .bridge_messages(WAIT, |status| status["state"] == "up")
        .await;

    // The phone goes away, then the bridge writes: the session keeps that message for a link that
    // is not there, and a fresh session must never inherit it.
    phone.disconnect().await;
    bridge.stream(&[512 * 1024]);
    bridge.kill_session();
    until(
        "the bridge never wrote the message nobody could take",
        || bridge.written() > 0,
    )
    .await;

    // A phone that has forgotten its session asks for a new one, not a resume.
    phone.link = Link::client(CONFIG);
    assert_eq!(
        phone.connect_lan(daemon.lan(), WAIT).await,
        Some(false),
        "the machine resumed a session the phone no longer had"
    );
    phone
        .bridge_messages(WAIT, |status| status["state"] == "up")
        .await;
    let deadline = Instant::now() + Duration::from_millis(500);
    while Instant::now() < deadline {
        phone.step().await;
    }
    assert!(
        phone.messages.is_empty(),
        "a fresh session was handed data the phone that reset never asked for: {} messages",
        phone.messages.len()
    );

    bridge.stop();
    daemon.stop().await;
}
