mod common;

use std::net::SocketAddr;
use std::path::Path;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use broski_link_daemon::letters::open::{open, Body, Decision as DaemonDecision};
use broski_link_daemon::push::{keys, seal};
use broski_link_session::push::{decision_letter, open_notification, Decision, LetterRequest};
use broski_link_session::{MachineRecord, Paired, PushPlatform, Route};
use common::bridge::BridgeStandIn;
use common::daemon::{Home, TestDaemon};
use common::relay::TestRelay;
use common::watch::{Watch, WAIT};
use common::{await_identity, quick, Phone};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::Instant;

const TOKEN: &str = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

/// Waits until the daemon stored this registration for the device in its `devices.json`.
async fn await_registration(home: &Path, record: &MachineRecord) {
    let expected = json!({
        "platform": "apns",
        "token": TOKEN,
        "key": URL_SAFE_NO_PAD.encode(&record.push_key),
    });
    let deadline = Instant::now() + WAIT;
    loop {
        let devices: Value = std::fs::read(home.join("devices.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(Value::Null);
        let stored = devices.as_array().and_then(|devices| {
            devices
                .iter()
                .find(|device| device["id"] == record.device_id.as_str())
        });
        if stored.is_some_and(|device| device["push"] == expected) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "the registration never reached devices.json: {devices}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_registered_phone_opens_what_the_machine_seals_for_it() {
    let home = Home::new();
    let daemon = TestDaemon::start(&home, None, true).await;
    let bridge = BridgeStandIn::start(&home.bridge_socket());
    let phone = Phone::new();
    let Paired { session, record } = phone
        .pair(&daemon, vec![daemon.lan().to_string()], quick())
        .await;
    let mut watch = Watch::new(session);
    watch.connected_on(0, Route::Lan).await;
    watch
        .session
        .register_push(PushPlatform::Apns, TOKEN.to_owned());
    await_registration(&home.path, &record).await;

    // Sealed by the daemon's own push code with the key the phone registered.
    let key: [u8; 32] = record.push_key.clone().try_into().expect("32 bytes");
    let notification = seal::Notification {
        v: 1,
        kind: "approval",
        title: "Approve Bash",
        body: "rm -rf /tmp/x",
        machine: &record.name,
        backend: "claude-code",
        session: "s-1",
        request: Some("req-1"),
        at: 1_725_000_000_000,
    };
    let plaintext = seal::encode(&notification).expect("fits");
    let sealed = seal::seal(&keys::notify(&key), record.id.as_bytes(), &plaintext).expect("sealed");
    let opened = open_notification(&record, &URL_SAFE_NO_PAD.encode(sealed)).expect("opens");
    assert_eq!(opened.title, "Approve Bash");
    assert_eq!(opened.machine, record.name);
    assert_eq!(opened.request.as_deref(), Some("req-1"));
    assert_eq!(opened.at_ms, 1_725_000_000_000);
    bridge.stop();
    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_lock_screen_decision_reaches_the_bridge_through_the_relay_and_the_machine() {
    let relay = TestRelay::start().await;
    let home = Home::new();
    let daemon = TestDaemon::start(&home, Some(&relay.url), true).await;
    let bridge = BridgeStandIn::start(&home.bridge_socket());
    await_identity(&relay, &daemon).await;
    let phone = Phone::new();
    let Paired { session, record } = phone
        .pair(&daemon, vec![daemon.lan().to_string()], quick())
        .await;
    let mut watch = Watch::new(session);
    watch.connected_on(0, Route::Lan).await;
    watch
        .session
        .register_push(PushPlatform::Apns, TOKEN.to_owned());
    await_registration(&home.path, &record).await;

    let letter = decision_letter(
        &record,
        Decision::Allow,
        "claude-code",
        "s-1",
        Some("req-1"),
    )
    .expect("a letter");
    assert_the_daemon_opens(&record, &letter);

    let (status, reply) = post(relay.addr, &letter).await;
    assert_eq!(status, 202, "{reply}");
    let id = reply["id"].as_u64().expect("letter id");
    await_decided(&relay, &bridge, &record, id).await;
    bridge.stop();
    daemon.stop().await;
    relay.stop().await;
}

/// The daemon's own letter code opens the letter with the key the phone registered.
fn assert_the_daemon_opens(record: &MachineRecord, letter: &LetterRequest) {
    let key: [u8; 32] = record.push_key.clone().try_into().expect("32 bytes");
    let opened = open(&key, &record.id, &record.device_id, &letter.body)
        .expect("the daemon's letter code opens it");
    let Body::Decision {
        backend,
        session,
        request,
        decision,
    } = opened.body
    else {
        panic!("a decision letter");
    };
    assert_eq!((backend.as_str(), session.as_str()), ("claude-code", "s-1"));
    assert_eq!(request, Some(json!("req-1")));
    assert_eq!(decision, DaemonDecision::Allow);
}

/// Waits until the bridge got the decision and the machine retired the letter at the relay.
async fn await_decided(relay: &TestRelay, bridge: &BridgeStandIn, record: &MachineRecord, id: u64) {
    let deadline = Instant::now() + WAIT;
    loop {
        let decided = bridge.decisions().iter().any(|decision| {
            decision["request"] == "req-1"
                && decision["decision"] == "allow"
                && decision["session"] == "s-1"
        });
        let pending = relay
            .hub
            .db()
            .pending_letters(&record.id, 0)
            .await
            .unwrap_or_default();
        if decided && !pending.iter().any(|letter| letter.id == id) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "the decision never reached the bridge and was acked"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// The POST the phone's notification handler sends, from the request the session built.
async fn post(relay: SocketAddr, letter: &LetterRequest) -> (u16, Value) {
    let path = letter
        .url
        .split_once(&relay.to_string())
        .expect("the relay's url")
        .1;
    let mut head = format!("POST {path} HTTP/1.1\r\nHost: {relay}\r\nConnection: close\r\n");
    for (name, value) in &letter.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!("Content-Length: {}\r\n\r\n", letter.body.len()));
    let mut stream = TcpStream::connect(relay).await.expect("connect");
    stream.write_all(head.as_bytes()).await.expect("head");
    stream.write_all(&letter.body).await.expect("body");
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.expect("response");
    let text = String::from_utf8(response).expect("utf8");
    let status = text
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or(0);
    let body = text.split("\r\n\r\n").nth(1).unwrap_or_default();
    (
        status,
        serde_json::from_str(body.trim()).unwrap_or(Value::Null),
    )
}
