//! The exports with no machine to talk to, over the fixtures the Swift and Kotlin tests share
//! (`tests/fixtures`).
//!
//! `offer.txt` is a QR offer written by the daemon's encoder (`PairingOffer::to_uri`) for the
//! machine whose stored record is `record.json`, paired with the device whose secret is
//! `device-secret.bin`. Its one LAN route, 127.0.0.1:9, refuses every connection and neither names
//! a relay, so nothing leaves the host. `push-record.json` and `push.txt` are the machine and the
//! sealed push of the vectors `docs/architecture/connectivity-v2/push.md` pins. `inbox-cache.json`
//! is an `InboxUpdate.cache` of that machine's inbox: a session waiting on `npm test` and an idle
//! one.

use std::sync::Arc;
use std::time::Duration;

use broski_client::{
    ClientError, ContractState, InboxState, LinkFailure, MachineStatus, PhoneConfig, SeenMarker,
    SeenState, SessionUpdate,
};
use broski_contract::{ClientMessage, HelloRequest, SessionRef, PROTOCOL_VERSION};
use broski_core::{
    decision_letter, new_identity_secret, open_notification, parse_pairing_offer, Machine,
    MachineRecord, Phone, PushDecision,
};
use broski_link_session::{LinkState, Platform, WaitReason};
use tokio::time::timeout;

fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|error| panic!("{path}: {error}"))
}

fn text(name: &str) -> String {
    String::from_utf8(fixture(name)).expect("utf-8")
}

fn config() -> PhoneConfig {
    PhoneConfig {
        device_name: "Test Phone".into(),
        platform: Platform::Ios,
        client_name: "broski-mobile tests".into(),
        client_version: "0.0.0".into(),
    }
}

/// The phone of the fixtures' pairing.
fn phone() -> Arc<Phone> {
    Phone::new(fixture("device-secret.bin"), config()).expect("a phone")
}

/// Pulls the machine's events until its status satisfies `done`.
async fn status_until(machine: &Machine, done: impl Fn(&MachineStatus) -> bool) {
    while !done(&machine.status()) {
        timeout(Duration::from_secs(10), machine.next_event())
            .await
            .unwrap_or_else(|_| panic!("timed out at {:?}", machine.status()))
            .expect("the machine goes on");
    }
}

#[test]
fn the_offer_names_the_machine_the_record_was_paired_with() {
    let offer = parse_pairing_offer(text("offer.txt")).expect("offer");
    let record = MachineRecord::from_bytes(fixture("record.json")).expect("record");
    assert_eq!(offer.machine_id, record.id());
    assert_eq!(offer.name, "Studio Mac");
    assert_eq!(offer.expires_at, 4_102_444_800);
    assert_eq!(record.to_bytes(), fixture("record.json"));
    assert!(matches!(
        parse_pairing_offer("broski://pair?v=1".into()),
        Err(ClientError::Link {
            failure: LinkFailure::Offer,
            ..
        })
    ));
}

#[test]
fn a_phone_starts_from_a_new_secret_and_refuses_a_broken_one() {
    let secret = new_identity_secret().expect("a secret");
    let phone = Phone::new(secret.clone(), config()).expect("a phone");
    assert_eq!(phone.device_id().len(), 32);
    assert_eq!(
        Phone::new(secret, config()).expect("again").device_id(),
        phone.device_id()
    );
    assert!(matches!(
        Phone::new(vec![1, 2, 3], config()),
        Err(ClientError::Link {
            failure: LinkFailure::Identity,
            ..
        })
    ));
}

#[tokio::test]
async fn a_pairing_with_an_unreachable_machine_says_why() {
    let paired = phone().pair(text("offer.txt")).await;
    assert!(
        matches!(
            paired,
            Err(ClientError::Link {
                failure: LinkFailure::MachineUnreachable,
                ..
            })
        ),
        "{:?}",
        paired.err()
    );
}

#[tokio::test]
async fn a_stored_machine_retries_its_dial_holds_its_views_and_ends_when_forgotten() {
    let phone = phone();
    let record = MachineRecord::from_bytes(fixture("record.json")).expect("record");
    let machine = phone.start(record.clone()).expect("started");
    assert_eq!(machine.id(), record.id());
    assert_eq!(machine.record().to_bytes(), record.to_bytes());
    assert_eq!(phone.all_machines().len(), 1);
    status_until(&machine, |status| {
        status.link.state == LinkState::Waiting(WaitReason::Retry)
    })
    .await;
    assert_eq!(machine.status().contract, ContractState::Waiting);

    let session = SessionRef {
        backend: "pi".to_owned(),
        session_id: "s-1".into(),
    };
    let view = machine.attach(session.clone()).expect("a view");
    assert_eq!(view.session(), Some(session));
    assert_eq!(
        view.snapshot(),
        None,
        "not attached until a bridge is ready"
    );
    let hello = ClientMessage::Hello(HelloRequest {
        request_id: String::new(),
        protocol: PROTOCOL_VERSION,
        client: broski_contract::ClientInfo {
            name: "app".into(),
            version: "1".into(),
        },
    });
    assert!(matches!(
        machine.request(hello).await,
        Err(ClientError::InvalidRequest { .. })
    ));

    phone.forget(machine.id());
    assert!(phone.machine(machine.id()).is_none());
    let ended = async { while machine.next_event().await.is_some() {} };
    timeout(Duration::from_secs(10), ended)
        .await
        .expect("the machine's events end");
    assert_eq!(machine.status().link.state, LinkState::Closed);
    let pending = timeout(Duration::from_secs(10), view.next_update()).await;
    assert!(
        matches!(pending, Ok(Some(SessionUpdate::Ended { .. }))),
        "{pending:?}"
    );
}

#[test]
fn what_was_seen_goes_back_in_as_the_app_stored_it() {
    let inbox = phone().inbox();
    assert!(inbox.rows().is_empty());
    let machine_id = "00112233445566778899aabbccddeeff";
    let stored = SeenState {
        markers: vec![SeenMarker {
            machine_id: machine_id.into(),
            session: SessionRef {
                backend: "claude-code".to_owned(),
                session_id: "s-9".into(),
            },
            seen_at: 1_725_000_000_000,
        }],
        read_machines: vec![machine_id.into(), "ffeeddccbbaa99887766554433221100".into()],
    };
    inbox.restore_seen(stored.clone());
    assert_eq!(inbox.seen(), stored);
}

#[tokio::test]
async fn the_cached_inbox_shows_its_machines_rows_until_it_answers_and_never_offers_an_answer() {
    let phone = phone();
    let inbox = phone.inbox();
    let refused = inbox.restore_cache(b"{\"version\":0,\"rows\":[]}".to_vec());
    assert!(matches!(refused, Err(ClientError::InvalidRequest { .. })));
    inbox
        .restore_cache(fixture("inbox-cache.json"))
        .expect("the cache restores");
    assert!(inbox.rows().is_empty(), "no row before its machine starts");

    let record = MachineRecord::from_bytes(fixture("record.json")).expect("record");
    let machine = phone.start(record).expect("started");
    let rows = inbox.rows();
    let shown: Vec<_> = rows
        .iter()
        .map(|row| (row.session.session_id.as_str(), row.state, row.cached))
        .collect();
    assert_eq!(
        shown,
        [
            ("s-ask", InboxState::NeedsYou, true),
            ("s-old", InboxState::Idle, true),
        ]
    );
    assert_eq!(rows[0].command.as_deref(), Some("npm test"));
    assert!(rows.iter().all(|row| row.pending.is_none()));
    phone.forget(machine.id());
    assert!(
        inbox.rows().is_empty(),
        "a forgotten machine takes its cached rows"
    );
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
    assert!(matches!(
        open_notification(record.clone(), "AAAA".into()),
        Err(ClientError::Link {
            failure: LinkFailure::Push,
            ..
        })
    ));

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
