//! The exports over the fixtures the Swift and Kotlin smoke tests share (`tests/fixtures`).
//!
//! `offer.txt` is a QR offer written by the daemon's encoder (`PairingOffer::to_uri`) for the
//! machine whose stored record is `record.json`, paired with the device whose secret is
//! `device-secret.bin`. Its one LAN route, 127.0.0.1:9, refuses every connection and neither names
//! a relay, so nothing leaves the host. `push-record.json` and `push.txt` are the machine and the
//! sealed push of the vectors `docs/architecture/connectivity-v2/push.md` pins.

use std::sync::Arc;
use std::time::Duration;

use broski_contract::{ClientInfo, ClientMessage, HelloRequest, ProtocolVersion, ServerMessage};
use broski_core::{
    decision_letter, decode_frame, encode_frame, open_notification, pair, CoreError,
    DeviceIdentity, LinkEvent, LinkRuntime, LinkSession, MachineRecord, PairingOffer, PushDecision,
    SessionOptions,
};
use broski_link_session::{LinkState, Platform, WaitReason};

fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|error| panic!("{path}: {error}"))
}

fn text(name: &str) -> String {
    String::from_utf8(fixture(name)).expect("utf-8")
}

fn options() -> SessionOptions {
    SessionOptions {
        device_name: "Test Phone".into(),
        platform: Platform::Ios,
    }
}

fn identity() -> Arc<DeviceIdentity> {
    DeviceIdentity::from_secret(fixture("device-secret.bin")).expect("identity")
}

#[test]
fn the_offer_pins_the_machine_the_record_was_paired_with() {
    let offer = PairingOffer::parse(text("offer.txt")).expect("offer");
    let record = MachineRecord::from_bytes(fixture("record.json")).expect("record");
    assert_eq!(offer.machine_id(), record.id());
    assert_eq!(offer.name(), "Studio Mac");
    assert_eq!(offer.expires_at(), 4_102_444_800);
    assert_eq!(record.to_bytes(), fixture("record.json"));
}

#[tokio::test]
async fn a_pairing_with_an_unreachable_machine_fails_and_spends_the_offer() {
    let runtime = LinkRuntime::new().expect("runtime");
    let offer = PairingOffer::parse(text("offer.txt")).expect("offer");
    let first = pair(runtime.clone(), identity(), offer.clone(), options()).await;
    assert!(matches!(first, Err(CoreError::MachineUnreachable(_))));
    let again = pair(runtime, identity(), offer, options()).await;
    assert!(matches!(again, Err(CoreError::OfferUsed)));
}

#[tokio::test]
async fn a_stored_session_reports_its_failed_dial_then_its_close() {
    let runtime = LinkRuntime::new().expect("runtime");
    let record = MachineRecord::from_bytes(fixture("record.json")).expect("record");
    let session =
        LinkSession::start(runtime, identity(), record.clone(), options()).expect("start");
    assert_eq!(session.machine_id(), record.id());

    let mut states = Vec::new();
    let retrying = tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(LinkEvent::Status { status }) = session.next_event().await {
            states.push(status.state);
            if status.state == LinkState::Waiting(WaitReason::Retry) {
                return;
            }
        }
    });
    retrying
        .await
        .expect("the dial fails and a retry is scheduled");

    session.end();
    let mut last = None;
    while let Some(event) = session.next_event().await {
        if let LinkEvent::Status { status } = event {
            last = Some(status.state);
        }
    }
    assert_eq!(last, Some(LinkState::Closed), "after {states:?}");
}

#[test]
fn a_contract_message_crosses_the_frame_both_ways() {
    let hello = ClientMessage::Hello(HelloRequest {
        request_id: "r-1".into(),
        protocol: ProtocolVersion { major: 1, minor: 0 },
        client: ClientInfo {
            name: "broski-ios".into(),
            version: "1.0.0".into(),
        },
    });
    let sent: serde_json::Value = serde_json::from_slice(&encode_frame(hello)).expect("json");
    assert_eq!(sent["type"], "contract");
    assert_eq!(sent["message"]["type"], "hello");
    assert_eq!(sent["message"]["client"]["name"], "broski-ios");

    let reply = br#"{"type":"contract","message":{"type":"hello.result","requestId":"r-1","protocol":{"major":1,"minor":0},"bridgeVersion":"2.0.0"}}"#;
    let ServerMessage::HelloResult(result) = decode_frame(reply.to_vec()).expect("frame") else {
        panic!("a hello result");
    };
    assert_eq!(result.bridge_version, "2.0.0");
    assert!(matches!(
        decode_frame(b"{\"type\":\"contract\"}".to_vec()),
        Err(CoreError::Frame(_))
    ));
}

#[test]
fn the_pinned_push_opens_and_a_decision_seals_for_the_relay() {
    let record = MachineRecord::from_bytes(fixture("push-record.json")).expect("record");
    let push = open_notification(record.clone(), text("push.txt")).expect("opens");
    assert_eq!(
        (push.kind.as_str(), push.title.as_str()),
        ("approval", "Approve Bash")
    );
    assert_eq!(push.request.as_deref(), Some("req-1"));

    let letter = decision_letter(record, PushDecision::Deny, "pi".into(), "s-2".into(), None)
        .expect("letter");
    assert_eq!(letter.url, "https://relay.example/v1/letters");
    let header = |name: &str| {
        letter
            .headers
            .iter()
            .find(|header| header.name == name)
            .map(|header| header.value.as_str())
    };
    assert_eq!(
        header("x-broski-machine"),
        Some("00112233445566778899aabbccddeeff")
    );
    assert_eq!(header("authorization"), Some("Bearer token"));
    assert!(letter.body.len() > 12 + 16);
}
