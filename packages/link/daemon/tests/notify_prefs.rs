mod common;

use std::time::Duration;

use broski_relay::limits::Limits;
use common::apns::ApnsMock;
use common::relay::TestRelay;
use common::scenario::{quick_durations, Scenario, WAIT};
use common::sealed::open_notification;
use serde_json::{json, Value};

const AT: u64 = 1_725_000_000_000;
const SILENCE: Duration = Duration::from_millis(600);

fn event(kind: &str, session: &str, request: Option<&str>) -> Value {
    json!({
        "type": "link_event",
        "kind": kind,
        "backend": "claude-code",
        "session": session,
        "cwd": "proj",
        "title": "proj — something",
        "body": "words",
        "at": AT,
        "request": request,
    })
}

fn prefs(needs_you: bool, done: bool, failures: bool, muted: &[&str]) -> Value {
    json!({
        "t": "notify_prefs",
        "needs_you": needs_you,
        "done": done,
        "failures": failures,
        "muted": muted
            .iter()
            .map(|session| json!({"backend": "claude-code", "session": session}))
            .collect::<Vec<_>>(),
    })
}

async fn stored_notify(scenario: &Scenario, expected: Value) {
    let deadline = tokio::time::Instant::now() + WAIT;
    while scenario.push_registration()["notify"] != expected {
        assert!(
            tokio::time::Instant::now() < deadline,
            "the notification settings never reached the device record: {}",
            scenario.push_registration()
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// What a phone turns off is never pushed, because a phone that is closed cannot hide an alert
/// it has already been sent; what stays on still is.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_alert_the_phone_turned_off_is_never_pushed() {
    let apns = ApnsMock::start().await;
    let relay = TestRelay::start_with(apns.push_config().await, Limits::default()).await;
    let mut scenario = Scenario::start(relay, quick_durations()).await;
    let machine_id = scenario.machine.clone();
    scenario.await_alert_targets().await;

    scenario
        .phone
        .send_control(prefs(true, false, false, &["s-muted"]))
        .await;
    stored_notify(
        &scenario,
        json!({"needs_you": true, "done": false, "failures": false,
               "muted": [{"backend": "claude-code", "session": "s-muted"}]}),
    )
    .await;
    scenario.phone.disconnect().await;
    scenario.await_session(false).await;
    assert!(
        scenario.alert_targets().await.is_empty(),
        "with Failures off the relay is not asked to alert about an offline Mac"
    );

    scenario.feed.send(event("done", "s-1", None));
    scenario.feed.send(event("failed", "s-1", None));
    scenario
        .feed
        .send(event("approval", "s-muted", Some("req-muted")));
    assert_eq!(
        apns.sent.quiet(SILENCE).await,
        0,
        "a finished run, a failure and a muted session's approval stay unsent"
    );

    scenario.feed.send(event("attention", "s-1", Some("req-1")));
    let sent = apns.sent.wait(1, WAIT).await;
    assert_eq!(sent[0].body()["k"], "attention");

    assert_eq!(
        scenario.phone.connect_lan(scenario.address(), WAIT).await,
        Some(true)
    );
    scenario
        .phone
        .send_control(prefs(true, true, true, &[]))
        .await;
    scenario.await_alert_targets().await;
    scenario.phone.disconnect().await;
    scenario.await_session(false).await;
    scenario.feed.send(event("failed", "s-1", None));
    let sent = apns.sent.wait(2, WAIT).await;
    assert_eq!(
        sent[1].body()["k"],
        "done",
        "the relay knows a failure as a finish"
    );
    assert_eq!(sent[1].header("apns-collapse-id"), "d-s-1");
    assert_eq!(
        open_notification(&sent[1].data(), &machine_id)["kind"],
        "failed",
        "the phone reads the real kind from the sealed payload"
    );

    scenario.stop().await;
}

/// A request that is over is not told to an iPhone: its push cannot be shown without showing.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_resolved_request_pushes_nothing_to_an_iphone() {
    let apns = ApnsMock::start().await;
    let relay = TestRelay::start_with(apns.push_config().await, Limits::default()).await;
    let mut scenario = Scenario::start(relay, quick_durations()).await;
    scenario.phone.disconnect().await;
    scenario.await_session(false).await;

    scenario.feed.send(
        json!({"type": "link_resolved", "backend": "claude-code", "session": "s-1", "request": "req-1", "at": AT}),
    );
    assert_eq!(apns.sent.quiet(SILENCE).await, 0);

    scenario.stop().await;
}

/// A request replayed by a feed that redialled is not pushed again, however long it has waited.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_replayed_request_is_pushed_once_and_a_second_run_of_a_session_is_pushed_too() {
    let apns = ApnsMock::start().await;
    let relay = TestRelay::start_with(apns.push_config().await, Limits::default()).await;
    let mut scenario = Scenario::start(relay, quick_durations()).await;
    scenario.phone.disconnect().await;
    scenario.await_session(false).await;

    scenario.feed.send(event("approval", "s-1", Some("req-1")));
    apns.sent.wait(1, WAIT).await;
    scenario.feed.send(event("approval", "s-1", Some("req-1")));
    assert_eq!(apns.sent.quiet(SILENCE).await, 1);

    let mut first = event("done", "s-1", None);
    let mut second = event("done", "s-1", None);
    first["at"] = json!(AT);
    second["at"] = json!(AT + 30_000);
    scenario.feed.send(first);
    scenario.feed.send(second);
    assert_eq!(
        apns.sent.wait(3, WAIT).await.len(),
        3,
        "two runs that end close together are two finishes"
    );

    scenario.stop().await;
}
