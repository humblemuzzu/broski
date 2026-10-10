//! The push and letter wire formats against vectors computed outside this crate (Node's OpenSSL
//! ChaCha20-Poly1305), so a change to a label, an AAD or a field order fails here.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use broski_link_daemon::letters::open;
use broski_link_daemon::push::{keys, seal};
use serde_json::Value;

const K: [u8; 32] = [
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
];
const K_B64: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const NOTIFY_KEY_HEX: &str = "505ae8693846c4ed5fa9bbc8bcf76ece21ce094f17fe9aeac073d747924c18aa";
const LETTER_KEY_HEX: &str = "4dadde591d18313f5a52adf5e141625d088ea72b897634b10a8ca81b81568acb";
const MACHINE: &str = "00112233445566778899aabbccddeeff";
const DEVICE: &str = "ffeeddccbbaa99887766554433221100";
const NONCE: [u8; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AT: u64 = 1_725_000_000_000;

const PUSH_PLAINTEXT: &str = r#"{"v":1,"kind":"approval","title":"Approve Bash","body":"rm -rf /tmp/x","machine":"studio","backend":"claude-code","session":"s-1","request":"req-1","at":1725000000000}"#;
const PUSH_DATA: &str = "AAECAwQFBgcICQoLGP7NBqpe6fhmcRNNJuVawmekWhPUZPom-mq8ZzhnTslXseBbcfqZqXlXJdPEbtDWLbFnH60g4K2bNEgCgUuQAopC812JSrEC3djnYEBxRERNasUc0ySeDbPOItHmHtxh-rLeWJ8SVgZbuFz2JfdxnOMDMjpPHuuH6EVTsd2PELEKAWhErt4BLWBPMtp8aF0itaJ76RGjuBepM0THYB5VVvEoLRstI-AyhPjpUijXNwBR_ziZedbO";

const LETTER_ID: &str = "00112233445566778899aabbccddeeff";
const LETTER_PLAINTEXT: &str = r#"{"v":1,"id":"00112233445566778899aabbccddeeff","at":1725000000000,"kind":"decision","backend":"claude-code","session":"s-1","request":"req-1","decision":"allow"}"#;
const LETTER_DATA: &str = "AAECAwQFBgcICQoLVRHy1XQgQ9n016Elt0wPN4w9zepY4Su0q5hZ-Z-pmP9Iklw4GjQfdHQF5acpnK-Vj2nA6gxu2Xdi--V9t4FbShNWUQDsTv_4COgt2Sf4JPgS-YHGQij1GWbZfFro6isfIQGmluu6P-hj6rh_FQIElavvQn8gpocOyk3CEWg2QyYp2plNM4Q_xFf3VigfFFbo_1ClYwgDYpD7PutLUC0IFrk6JmLev7WfDdpJqffKKGsU";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

#[test]
fn the_two_keys_are_hmac_sha256_of_their_labels() {
    let notify = keys::notify(&K);
    let letter = keys::letter(&K);
    assert_eq!(hex(&notify[..]), NOTIFY_KEY_HEX);
    assert_eq!(hex(&letter[..]), LETTER_KEY_HEX);
    assert_ne!(&notify[..], &letter[..]);
}

#[test]
fn a_registered_key_is_the_b64url_of_32_bytes_and_nothing_else() {
    assert_eq!(keys::decode(K_B64).as_deref(), Some(&K));
    assert!(keys::decode("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHg").is_none());
    assert!(keys::decode("not base64!").is_none());
    assert!(keys::decode("").is_none());
}

#[test]
fn the_push_ciphertext_and_its_field_order_are_pinned() {
    let notification = seal::Notification {
        v: 1,
        kind: "approval",
        title: "Approve Bash",
        body: "rm -rf /tmp/x",
        machine: "studio",
        backend: "claude-code",
        session: "s-1",
        request: Some("req-1"),
        at: AT,
    };
    let plaintext = serde_json::to_vec(&notification).expect("the notification encodes");
    assert_eq!(
        String::from_utf8(plaintext.clone()).expect("utf8"),
        PUSH_PLAINTEXT
    );

    let notify = keys::notify(&K);
    let data = seal::seal_with(&notify, &NONCE, MACHINE.as_bytes(), &plaintext)
        .expect("the payload seals");
    assert_eq!(b64(&data), PUSH_DATA);
    assert_eq!(
        seal::open(&notify, MACHINE.as_bytes(), &data).as_deref(),
        Some(plaintext.as_slice())
    );
    assert!(
        seal::open(&notify, MACHINE.to_uppercase().as_bytes(), &data).is_none(),
        "the machine id is the additional data"
    );
}

#[test]
fn the_letter_ciphertext_is_pinned_and_bound_to_one_device() {
    let letter = keys::letter(&K);
    let aad = format!("{MACHINE}:{DEVICE}");
    let data = seal::seal_with(&letter, &NONCE, aad.as_bytes(), LETTER_PLAINTEXT.as_bytes())
        .expect("the letter seals");
    assert_eq!(b64(&data), LETTER_DATA);
}

#[test]
fn a_decision_letter_opens_with_the_devices_registered_key() {
    let data = URL_SAFE_NO_PAD.decode(LETTER_DATA).expect("b64url");
    let opened = open::open(&K, MACHINE, DEVICE, &data).expect("the letter opens");
    assert_eq!(opened.id, LETTER_ID);
    assert_eq!(opened.at, AT);
    match opened.body {
        open::Body::Decision {
            backend,
            session,
            request,
            decision,
        } => {
            assert_eq!(backend, "claude-code");
            assert_eq!(session, "s-1");
            assert_eq!(request.as_ref().and_then(Value::as_str), Some("req-1"));
            assert_eq!(decision, open::Decision::Allow);
        }
        open::Body::Bridge { .. } => panic!("a decision letter, not a bridge message"),
    }
}

#[test]
fn a_letter_for_another_machine_or_device_never_opens() {
    let data = URL_SAFE_NO_PAD.decode(LETTER_DATA).expect("b64url");
    assert!(open::open(&K, "112233445566778899aabbccddeeff00", DEVICE, &data).is_none());
    assert!(open::open(&K, MACHINE, "00112233445566778899aabbccddee00", &data).is_none());
    assert!(open::open(&K, MACHINE, DEVICE, &data[..data.len() - 1]).is_none());
}
