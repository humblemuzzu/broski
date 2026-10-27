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

const LETTER_LABEL: &[u8] = b"broski-letter-v1";
const SILENCE: Duration = Duration::from_secs(2);
const SESSION_IDLE: Duration = Duration::from_millis(100);
const LETTERS: usize = 4;

/// Letters for a device with no live session share the one bridge socket that device keeps for
/// them: a burst of letters opens one socket, not one each.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn letters_with_no_live_session_share_one_bridge_socket() {
    let durations = broski_link_daemon::durations::Durations {
        session_idle: SESSION_IDLE,
        ..quick_durations()
    };
    let mut scenario = Scenario::start(TestRelay::start().await, durations).await;
    scenario.phone.disconnect().await;
    scenario.await_session(false).await;
    tokio::time::sleep(SESSION_IDLE + Duration::from_millis(300)).await;

    let before = scenario.feed.roles("owner");
    let mut ids = Vec::new();
    for index in 0..LETTERS {
        let body = json!({
            "v": 1,
            "id": format!("ffeeddccbbaa9988776655443322110{index}"),
            "at": now_ms(),
            "kind": "bridge",
            "message": format!("letter {index}"),
        });
        let letter = seal(
            &scenario.machine,
            &scenario.device,
            &serde_json::to_vec(&body).expect("the letter encodes"),
        );
        let (status, posted) = scenario.post_letter(&letter).await;
        assert_eq!(status, 202, "{posted}");
        ids.push(posted["id"].as_u64().expect("a letter id"));
        scenario
            .feed
            .await_text(&format!("letter {index}"), WAIT)
            .await;
    }
    for id in ids {
        scenario.await_acked(id).await;
    }
    assert_eq!(
        scenario.feed.roles("owner") - before,
        1,
        "every letter dialled a socket of its own"
    );
    scenario.stop().await;
}

/// A letter the bridge never took is not acknowledged: the relay has to hand it over again.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_letter_the_bridge_never_took_is_not_acknowledged() {
    let durations = broski_link_daemon::durations::Durations {
        session_idle: SESSION_IDLE,
        ..quick_durations()
    };
    let mut scenario = Scenario::start(TestRelay::start().await, durations).await;
    scenario.phone.disconnect().await;
    scenario.await_session(false).await;

    let body = json!({
        "v": 1,
        "id": "ffeeddccbbaa99887766554433221100",
        "at": now_ms(),
        "kind": "bridge",
        "message": "nobody is listening",
    });
    let letter = seal(
        &scenario.machine,
        &scenario.device,
        &serde_json::to_vec(&body).expect("the letter encodes"),
    );

    let machine = scenario.machine.clone();
    let device = scenario.device.clone();
    let token = scenario.token.clone();
    let relay = scenario.relay.addr;

    // Nothing is listening on the bridge socket any more, so no letter can be delivered.
    scenario.feed.stop().await;
    tokio::time::sleep(SESSION_IDLE + Duration::from_millis(300)).await;

    let (status, posted) =
        common::relay_http::post_letter(relay, &machine, &device, &token, &letter).await;
    assert_eq!(status, 202, "{posted}");
    let id = posted["id"].as_u64().expect("a letter id");

    tokio::time::sleep(SILENCE).await;
    let pending = scenario
        .relay
        .hub
        .db()
        .pending_letters(&machine, 0)
        .await
        .unwrap_or_default();
    assert!(
        pending.iter().any(|letter| letter.id == id),
        "the letter was acknowledged without reaching the bridge"
    );
    scenario.daemon.stop().await;
    scenario.relay.stop().await;
}

fn seal(machine: &str, device: &str, plaintext: &[u8]) -> Vec<u8> {
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(&key()).expect("a 32-byte key is never rejected");
    mac.update(LETTER_LABEL);
    let key: [u8; 32] = mac.finalize().into_bytes().into();
    let cipher = ChaCha20Poly1305::new_from_slice(&key).expect("a 256-bit key");
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut nonce).expect("system randomness");
    let aad = format!("{machine}:{device}");
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
