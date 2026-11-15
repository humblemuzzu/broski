//! What the notification handlers need from a machine record (`push.md`): opening a push the
//! machine sealed, and sealing a lock-screen decision as a letter for the relay. Both are pure, so
//! the iOS notification service extension and the Android message handler call them without a
//! session or a runtime.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::clock::unix_ms;
use crate::endpoint::relay_http;
use crate::error::Error;
use crate::record::MachineRecord;

const NOTIFY_LABEL: &[u8] = b"broski-notify-v1";
const LETTER_LABEL: &[u8] = b"broski-letter-v1";
const NONCE: usize = 12;
const TAG: usize = 16;

/// The plaintext of one machine push.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notification {
    /// `approval`, `attention` or `done`.
    pub kind: String,
    pub title: String,
    pub body: String,
    /// The machine's name.
    pub machine: String,
    pub backend: String,
    pub session: String,
    /// The interaction a decision on this alert must echo.
    pub request: Option<String>,
    pub at_ms: u64,
}

/// A lock-screen answer to an `approval` alert.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny,
}

/// The `POST` the notification handler sends to the relay: `body` is opaque to the relay.
#[derive(Clone, PartialEq, Eq)]
pub struct LetterRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// Opens the `e` (APNs) or `data.e` (FCM) field of a push from `record`'s machine.
pub fn open_notification(record: &MachineRecord, data: &str) -> Result<Notification, Error> {
    let key = derive(&record.push_key()?, NOTIFY_LABEL);
    let sealed = URL_SAFE_NO_PAD
        .decode(data)
        .map_err(|_| Error::Push("the payload is not b64url"))?;
    let plaintext = open(&key, record.id.as_bytes(), &sealed)?;
    let value: Value =
        serde_json::from_slice(&plaintext).map_err(|_| Error::Push("the payload is not JSON"))?;
    notification(&value).ok_or(Error::Push("the payload is not a notification"))
}

fn notification(value: &Value) -> Option<Notification> {
    if value.get("v")?.as_u64()? != 1 {
        return None;
    }
    let text = |key: &str| value.get(key)?.as_str().map(str::to_owned);
    let request = match value.get("request")? {
        Value::Null => None,
        request => Some(request.as_str()?.to_owned()),
    };
    Some(Notification {
        kind: text("kind")?,
        title: text("title")?,
        body: text("body")?,
        machine: text("machine")?,
        backend: text("backend")?,
        session: text("session")?,
        request,
        at_ms: value.get("at")?.as_u64()?,
    })
}

/// Seals a decision on `request` of `session` as a letter for `record`'s machine. The letter is
/// bound to this device by its key and AAD, and to its moment by `at`: the machine refuses one
/// older than a day, and handles each letter id once.
pub fn decision_letter(
    record: &MachineRecord,
    decision: Decision,
    backend: &str,
    session: &str,
    request: Option<&str>,
) -> Result<LetterRequest, Error> {
    let token = record
        .relay_token
        .as_deref()
        .ok_or(Error::Push("the machine has no relay token"))?;
    let url = record
        .relay
        .as_deref()
        .and_then(|relay| relay_http(relay, "/v1/letters"))
        .ok_or(Error::Push(
            "the machine has no relay that can carry a letter",
        ))?;
    let decision = match decision {
        Decision::Allow => "allow",
        Decision::Deny => "deny",
    };
    let plaintext = json!({
        "v": 1,
        "id": hex(&random::<16>()?),
        "at": unix_ms(),
        "kind": "decision",
        "backend": backend,
        "session": session,
        "request": request,
        "decision": decision,
    });
    let body = seal_letter(record, &plaintext)?;
    Ok(LetterRequest {
        url: url.into(),
        headers: vec![
            ("x-broski-machine".to_owned(), record.id.clone()),
            ("x-broski-device".to_owned(), record.device_id.clone()),
            ("authorization".to_owned(), format!("Bearer {token}")),
            (
                "content-type".to_owned(),
                "application/octet-stream".to_owned(),
            ),
        ],
        body,
    })
}

/// Sealed under the letter key of this device, bound to the machine and the device by the AAD.
fn seal_letter(record: &MachineRecord, plaintext: &Value) -> Result<Vec<u8>, Error> {
    let key = derive(&record.push_key()?, LETTER_LABEL);
    let aad = format!("{}:{}", record.id, record.device_id);
    let nonce = random::<NONCE>()?;
    seal(
        &key,
        &nonce,
        aad.as_bytes(),
        plaintext.to_string().as_bytes(),
    )
}

/// A fresh push key K: 32 bytes from the system source.
pub(crate) fn generate_key() -> Result<[u8; 32], Error> {
    random()
}

fn random<const N: usize>() -> Result<[u8; N], Error> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|_| Error::Randomness)?;
    Ok(bytes)
}

/// `HMAC-SHA256(key = K, msg = label)`.
fn derive(key: &[u8; 32], label: &[u8]) -> Zeroizing<[u8; 32]> {
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC takes a key of any length");
    mac.update(label);
    Zeroizing::new(mac.finalize().into_bytes().into())
}

/// `nonce(12) || ChaCha20-Poly1305-IETF(key, nonce, plaintext, aad)`.
fn seal(
    key: &[u8; 32],
    nonce: &[u8; NONCE],
    aad: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>, Error> {
    let cipher = ChaCha20Poly1305::new(key.into());
    let sealed = cipher
        .encrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| Error::Push("the letter could not be sealed"))?;
    Ok([nonce.as_slice(), &sealed].concat())
}

fn open(key: &[u8; 32], aad: &[u8], data: &[u8]) -> Result<Vec<u8>, Error> {
    if data.len() < NONCE + TAG {
        return Err(Error::Push("the payload is truncated"));
    }
    let (nonce, sealed) = data.split_at(NONCE);
    ChaCha20Poly1305::new(key.into())
        .decrypt(Nonce::from_slice(nonce), Payload { msg: sealed, aad })
        .map_err(|_| Error::Push("the payload does not open with this machine's key"))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The vectors `push.md` pins, produced with Node's OpenSSL ChaCha20-Poly1305.
    const MACHINE: &str = "00112233445566778899aabbccddeeff";
    const DEVICE: &str = "ffeeddccbbaa99887766554433221100";
    const PUSH: &str = "AAECAwQFBgcICQoLGP7NBqpe6fhmcRNNJuVawmekWhPUZPom-mq8ZzhnTslXseBbcfqZqXlXJdPEbtDWLbFnH60g4K2bNEgCgUuQAopC812JSrEC3djnYEBxRERNasUc0ySeDbPOItHmHtxh-rLeWJ8SVgZbuFz2JfdxnOMDMjpPHuuH6EVTsd2PELEKAWhErt4BLWBPMtp8aF0itaJ76RGjuBepM0THYB5VVvEoLRstI-AyhPjpUijXNwBR_ziZedbO";
    const LETTER: &str = "AAECAwQFBgcICQoLVRHy1XQgQ9n016Elt0wPN4w9zepY4Su0q5hZ-Z-pmP9Iklw4GjQfdHQF5acpnK-Vj2nA6gxu2Xdi--V9t4FbShNWUQDsTv_4COgt2Sf4JPgS-YHGQij1GWbZfFro6isfIQGmluu6P-hj6rh_FQIElavvQn8gpocOyk3CEWg2QyYp2plNM4Q_xFf3VigfFFbo_1ClYwgDYpD7PutLUC0IFrk6JmLev7WfDdpJqffKKGsU";
    const LETTER_PLAINTEXT: &str = r#"{"v":1,"id":"00112233445566778899aabbccddeeff","at":1725000000000,"kind":"decision","backend":"claude-code","session":"s-1","request":"req-1","decision":"allow"}"#;

    fn key() -> [u8; 32] {
        std::array::from_fn(|index| index as u8)
    }

    fn record() -> MachineRecord {
        MachineRecord {
            id: MACHINE.into(),
            name: "studio".into(),
            os: None,
            public_bundle: Vec::new(),
            device_id: DEVICE.into(),
            relay: Some("wss://relay.example/base".into()),
            relay_token: Some("token".into()),
            lan: Vec::new(),
            push_key: key().to_vec(),
            paired_at_ms: 0,
        }
    }

    #[test]
    fn both_keys_match_the_pinned_vectors() {
        assert_eq!(
            hex(&*derive(&key(), NOTIFY_LABEL)),
            "505ae8693846c4ed5fa9bbc8bcf76ece21ce094f17fe9aeac073d747924c18aa"
        );
        assert_eq!(
            hex(&*derive(&key(), LETTER_LABEL)),
            "4dadde591d18313f5a52adf5e141625d088ea72b897634b10a8ca81b81568acb"
        );
    }

    #[test]
    fn the_pinned_push_opens_into_its_notification() {
        let notification = open_notification(&record(), PUSH).expect("opens");
        assert_eq!(
            notification,
            Notification {
                kind: "approval".into(),
                title: "Approve Bash".into(),
                body: "rm -rf /tmp/x".into(),
                machine: "studio".into(),
                backend: "claude-code".into(),
                session: "s-1".into(),
                request: Some("req-1".into()),
                at_ms: 1_725_000_000_000,
            }
        );
    }

    #[test]
    fn a_push_for_another_machine_or_cut_short_does_not_open() {
        let mut other = record();
        other.id = DEVICE.into();
        assert!(open_notification(&other, PUSH).is_err());
        assert!(open_notification(&record(), &PUSH[..PUSH.len() - 4]).is_err());
        assert!(open_notification(&record(), "!!").is_err());
    }

    #[test]
    fn the_letter_seal_matches_the_pinned_vector() {
        let nonce: [u8; NONCE] = std::array::from_fn(|index| index as u8);
        let aad = format!("{MACHINE}:{DEVICE}");
        let sealed = seal(
            &derive(&key(), LETTER_LABEL),
            &nonce,
            aad.as_bytes(),
            LETTER_PLAINTEXT.as_bytes(),
        )
        .expect("sealed");
        assert_eq!(URL_SAFE_NO_PAD.encode(sealed), LETTER);
    }

    #[test]
    fn a_decision_letter_names_the_relay_endpoint_and_this_device() {
        let letter = decision_letter(&record(), Decision::Deny, "pi", "s-2", None).expect("letter");
        assert_eq!(letter.url, "https://relay.example/v1/letters");
        assert_eq!(
            letter.headers[..3],
            [
                ("x-broski-machine".to_owned(), MACHINE.to_owned()),
                ("x-broski-device".to_owned(), DEVICE.to_owned()),
                ("authorization".to_owned(), "Bearer token".to_owned()),
            ]
        );
        let aad = format!("{MACHINE}:{DEVICE}");
        let plaintext =
            open(&derive(&key(), LETTER_LABEL), aad.as_bytes(), &letter.body).expect("opens");
        let value: Value = serde_json::from_slice(&plaintext).expect("json");
        assert_eq!(value["decision"], "deny");
        assert_eq!(value["request"], Value::Null);
        assert_eq!(value["id"].as_str().map(str::len), Some(32));

        let mut tokenless = record();
        tokenless.relay_token = None;
        assert!(decision_letter(&tokenless, Decision::Allow, "pi", "s", None).is_err());
    }
}
