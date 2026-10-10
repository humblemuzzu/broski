mod common;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce};
use common::relay::TestRelay;
use common::scenario::{quick_durations, Scenario, KEY_B64, WAIT};
use hmac::{Hmac, Mac};
use serde_json::json;
use sha2::Sha256;

const SILENCE: Duration = Duration::from_millis(600);
const LETTER_LABEL: &[u8] = b"broski-letter-v1";
const SESSION: &str = "s-1";
const REQUEST: &str = "req-1";

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_decision_letter_reaches_the_bridge_and_is_acked() {
    let scenario = Scenario::start(TestRelay::start().await, quick_durations()).await;

    let letter = decision(
        &scenario,
        "00112233445566778899aabbccddeeff",
        now_ms(),
        "allow",
    );
    let (status, posted) = scenario.post_letter(&letter).await;
    assert_eq!(status, 202, "{posted}");
    assert_eq!(posted["delivered"], true, "the machine socket was attached");

    let asked = scenario.feed.await_of_type("link_decision", WAIT).await;
    assert_eq!(asked["backend"], "claude-code");
    assert_eq!(asked["session"], SESSION);
    assert_eq!(asked["request"], REQUEST);
    assert_eq!(asked["decision"], "allow");

    scenario
        .await_acked(posted["id"].as_u64().expect("a letter id"))
        .await;
    scenario.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_replayed_or_stale_letter_is_acked_without_being_acted_on() {
    let scenario = Scenario::start(TestRelay::start().await, quick_durations()).await;
    let now = now_ms();

    let first = decision(&scenario, "00112233445566778899aabbccddeeff", now, "allow");
    let (_, posted) = scenario.post_letter(&first).await;
    assert_eq!(posted["delivered"], true);
    scenario.feed.await_of_type("link_decision", WAIT).await;
    scenario
        .await_acked(posted["id"].as_u64().expect("a letter id"))
        .await;

    let (_, replayed) = scenario.post_letter(&first).await;
    assert_eq!(replayed["delivered"], true);
    assert_eq!(
        scenario.feed.quiet("link_decision", SILENCE).await,
        1,
        "a replayed letter is never acted on twice"
    );
    scenario
        .await_acked(replayed["id"].as_u64().expect("a letter id"))
        .await;

    let stale = decision(
        &scenario,
        "ffeeddccbbaa99887766554433221100",
        now - 25 * 3600 * 1000,
        "deny",
    );
    let (_, aged) = scenario.post_letter(&stale).await;
    assert_eq!(aged["delivered"], true);
    assert_eq!(
        scenario.feed.quiet("link_decision", SILENCE).await,
        1,
        "a letter older than 24 h is never acted on"
    );
    scenario
        .await_acked(aged["id"].as_u64().expect("a letter id"))
        .await;
    scenario.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_bridge_letter_reaches_the_devices_own_bridge_socket() {
    let scenario = Scenario::start(TestRelay::start().await, quick_durations()).await;
    let text = r#"{"type":"chat","text":"hello from the lock screen"}"#;
    let body = json!({
        "v": 1,
        "id": "ffeeddccbbaa99887766554433221100",
        "at": now_ms(),
        "kind": "bridge",
        "message": text,
    });
    let letter = seal(
        &scenario,
        &serde_json::to_vec(&body).expect("the letter encodes"),
    );

    let (status, posted) = scenario.post_letter(&letter).await;
    assert_eq!(status, 202, "{posted}");
    scenario.feed.await_text(text, WAIT).await;
    assert_eq!(
        scenario.feed.device_of("owner").as_deref(),
        Some(&scenario.device[..]),
        "the message went out as that device"
    );
    scenario
        .await_acked(posted["id"].as_u64().expect("a letter id"))
        .await;
    scenario.stop().await;
}

fn decision(scenario: &Scenario, id: &str, at: u64, decision: &str) -> Vec<u8> {
    let body = json!({
        "v": 1,
        "id": id,
        "at": at,
        "kind": "decision",
        "backend": "claude-code",
        "session": SESSION,
        "request": REQUEST,
        "decision": decision,
    });
    seal(
        scenario,
        &serde_json::to_vec(&body).expect("the letter encodes"),
    )
}

/// Seals one letter exactly as the phone does: letter key, this machine and device as the AAD.
fn seal(scenario: &Scenario, plaintext: &[u8]) -> Vec<u8> {
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(&key()).expect("a 32-byte key is never rejected");
    mac.update(LETTER_LABEL);
    let key: [u8; 32] = mac.finalize().into_bytes().into();
    let cipher = ChaCha20Poly1305::new_from_slice(&key).expect("a 256-bit key");
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut nonce).expect("system randomness");
    let aad = format!("{}:{}", scenario.machine, scenario.device);
    let sealed = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: aad.as_bytes(),
            },
        )
        .expect("the letter seals");
    [nonce.as_slice(), sealed.as_slice()].concat()
}

fn key() -> [u8; 32] {
    URL_SAFE_NO_PAD
        .decode(KEY_B64)
        .expect("the registered key is b64url")
        .try_into()
        .expect("32 bytes")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}
