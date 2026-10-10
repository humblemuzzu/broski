mod common;

use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use broski_relay::limits::Limits;
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce};
use common::apns::{ApnsMock, Sent, APNS_TOPIC};
use common::relay::TestRelay;
use common::scenario::{quick_durations, Scenario, APNS_TOKEN, KEY_B64, WAIT};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

const AT: u64 = 1_725_000_000_000;
const SILENCE: Duration = Duration::from_millis(600);
const NOTIFY_LABEL: &[u8] = b"broski-notify-v1";

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_disconnected_phone_is_woken_and_a_connected_one_is_not() {
    let apns = ApnsMock::start().await;
    let relay = TestRelay::start_with(apns.push_config().await, Limits::default()).await;
    let mut scenario = Scenario::start(relay, quick_durations()).await;
    let machine_id = scenario.machine.clone();
    let machine_name = machine_name(&scenario).await;

    assert_registration(&scenario).await;
    assert_watch(&scenario).await;

    scenario.phone.disconnect().await;
    scenario.await_session(false).await;
    assert_detached_pushes(&scenario, &apns, &machine_id, &machine_name).await;
    assert_attached_silence(&mut scenario, &apns).await;
    assert_feed_liveness(&scenario);

    scenario.stop().await;
}

/// The registration is stored on the device and reaches the relay as an alert target.
async fn assert_registration(scenario: &Scenario) {
    assert_eq!(
        scenario.push_registration()["push"],
        json!({"platform": "apns", "token": APNS_TOKEN, "key": KEY_B64}),
        "the registration is stored on the device"
    );
    let mode = std::fs::metadata(scenario.daemon.home.join("devices.json"))
        .expect("devices.json")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o600, "the device list stays private");
    scenario.await_alert_targets().await;
}

/// `watch` follows what the feed says about the agents, and the relay sees both edges.
async fn assert_watch(scenario: &Scenario) {
    assert!(!scenario.watched(), "an idle machine is not watched");
    scenario
        .feed
        .send(json!({"type": "link_busy", "busy": true}));
    scenario.await_watched(true).await;
    scenario
        .feed
        .send(json!({"type": "link_busy", "busy": false}));
    scenario.await_watched(false).await;
}

/// One push per pending request, with the documented headers and a body the phone's key opens.
async fn assert_detached_pushes(
    scenario: &Scenario,
    apns: &ApnsMock,
    machine_id: &str,
    machine_name: &str,
) {
    scenario.feed.send(event("approval", "s-1", Some("req-1")));
    let sent = apns.sent.wait(1, WAIT).await;
    assert_eq!(sent.len(), 1);
    assert_push(
        &sent[0],
        "approval",
        "a-req-1",
        "10",
        machine_id,
        notification("approval", machine_name, "s-1", Some("req-1")),
    );

    assert_duplicate_suppressed(scenario, apns).await;

    scenario.feed.send(event("attention", "s-2", Some("req-2")));
    let sent = apns.sent.wait(2, WAIT).await;
    assert_push(
        &sent[1],
        "attention",
        "a-req-2",
        "10",
        machine_id,
        notification("attention", machine_name, "s-2", Some("req-2")),
    );

    scenario.feed.send(event("done", "s-9", None));
    let sent = apns.sent.wait(3, WAIT).await;
    assert_push(
        &sent[2],
        "done",
        "d-s-9",
        "5",
        machine_id,
        notification("done", machine_name, "s-9", None),
    );
    assert!(
        sent[2].body()["aps"]["sound"].is_null(),
        "a finished turn is silent"
    );
}

/// An event the window has already pushed is not pushed again.
async fn assert_duplicate_suppressed(scenario: &Scenario, apns: &ApnsMock) {
    scenario.feed.send(event("approval", "s-1", Some("req-1")));
    assert_eq!(
        apns.sent.quiet(SILENCE).await,
        1,
        "the same (kind, request) is never pushed twice inside the window"
    );
}

/// An attached phone is skipped: it already has the event on its link.
async fn assert_attached_silence(scenario: &mut Scenario, apns: &ApnsMock) {
    assert_eq!(
        scenario.phone.connect_lan(scenario.address(), WAIT).await,
        Some(true),
        "the phone comes back over the lan"
    );
    scenario.await_session(true).await;
    scenario.feed.send(event("approval", "s-3", Some("req-3")));
    assert_eq!(
        apns.sent.quiet(SILENCE).await,
        3,
        "an attached phone is not pushed"
    );
}

/// The feed is one socket that keeps itself alive across its own pings.
fn assert_feed_liveness(scenario: &Scenario) {
    assert_eq!(
        scenario.feed.roles("link-daemon"),
        1,
        "the feed survived its pings"
    );
    assert!(
        !scenario.feed.of_type("link_feed_ping").is_empty(),
        "the daemon pings the feed"
    );
}

async fn machine_name(scenario: &Scenario) -> String {
    scenario.daemon.ask(json!({"cmd": "status"})).await["machine"]["name"]
        .as_str()
        .expect("the daemon reports a machine name")
        .to_owned()
}

fn event(kind: &str, session: &str, request: Option<&str>) -> Value {
    let (title, body) = content(kind);
    let mut value = json!({
        "type": "link_event",
        "kind": kind,
        "backend": "claude-code",
        "session": session,
        "cwd": "proj",
        "title": title,
        "body": body,
        "at": AT,
    });
    if let Some(request) = request {
        value["request"] = json!(request);
    }
    value
}

fn notification(kind: &str, machine_name: &str, session: &str, request: Option<&str>) -> Value {
    let (title, body) = content(kind);
    json!({
        "v": 1,
        "kind": kind,
        "title": title,
        "body": body,
        "machine": machine_name,
        "backend": "claude-code",
        "session": session,
        "request": request,
        "at": AT,
    })
}

fn content(kind: &str) -> (&'static str, &'static str) {
    match kind {
        "approval" => ("Approve Bash", "rm -rf /tmp/x"),
        "attention" => ("Choose a branch", "Which one?"),
        _ => ("Finished", "All green"),
    }
}

fn assert_push(
    sent: &Sent,
    kind: &str,
    collapse: &str,
    priority: &str,
    machine_id: &str,
    expected: Value,
) {
    assert_eq!(sent.token, APNS_TOKEN);
    assert_eq!(sent.header("apns-push-type"), "alert");
    assert_eq!(sent.header("apns-topic"), APNS_TOPIC);
    assert_eq!(sent.header("apns-priority"), priority);
    assert_eq!(sent.header("apns-collapse-id"), collapse);
    assert_eq!(sent.body()["aps"]["category"], kind);
    assert_eq!(sent.body()["aps"]["mutable-content"], 1);
    assert_eq!(sent.body()["m"], machine_id);
    assert_eq!(sent.body()["k"], kind);
    let decoded: Value = serde_json::from_slice(&decrypt(NOTIFY_LABEL, machine_id, &sent.data()))
        .expect("the push body is json");
    assert_eq!(decoded, expected);
}

/// Opens the push data with the key the phone registered, not with the daemon's own helpers.
fn decrypt(label: &[u8], aad: &str, data: &[u8]) -> Vec<u8> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&registered_key())
        .expect("a 32-byte key is never rejected");
    mac.update(label);
    let key: [u8; 32] = mac.finalize().into_bytes().into();
    let cipher = ChaCha20Poly1305::new_from_slice(&key).expect("a 256-bit key");
    let (nonce, ciphertext) = data.split_at(12);
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .expect("the payload opens with the registered key")
}

fn registered_key() -> [u8; 32] {
    URL_SAFE_NO_PAD
        .decode(KEY_B64)
        .expect("the registered key is b64url")
        .try_into()
        .expect("32 bytes")
}
