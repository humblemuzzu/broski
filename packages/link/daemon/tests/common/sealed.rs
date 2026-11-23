use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;

use super::scenario::KEY_B64;

const NOTIFY_LABEL: &[u8] = b"broski-notify-v1";

/// Opens a push's data with the key the scenario's phone registered, with the primitives the
/// vector file pins rather than the daemon's own helpers.
pub fn open_notification(data: &[u8], machine_id: &str) -> Value {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&registered_key())
        .expect("a 32-byte key is never rejected");
    mac.update(NOTIFY_LABEL);
    let key: [u8; 32] = mac.finalize().into_bytes().into();
    let cipher = ChaCha20Poly1305::new_from_slice(&key).expect("a 256-bit key");
    let (nonce, ciphertext) = data.split_at(12);
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: machine_id.as_bytes(),
            },
        )
        .expect("the payload opens with the registered key");
    serde_json::from_slice(&plaintext).expect("the push body is json")
}

fn registered_key() -> [u8; 32] {
    URL_SAFE_NO_PAD
        .decode(KEY_B64)
        .expect("the registered key is b64url")
        .try_into()
        .expect("32 bytes")
}
