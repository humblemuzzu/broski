use hmac::{Hmac, Mac};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::codec;

const NOTIFY_LABEL: &[u8] = b"broski-notify-v1";
const LETTER_LABEL: &[u8] = b"broski-letter-v1";

/// A 32-byte key material; wiped on drop.
pub type Secret = Zeroizing<[u8; 32]>;

/// Decodes the `key` a phone registers: b64url, exactly 32 bytes.
pub fn decode(text: &str) -> Option<Secret> {
    let bytes: [u8; 32] = codec::b64url_decode(text)?.try_into().ok()?;
    Some(Zeroizing::new(bytes))
}

pub fn notify(key: &[u8; 32]) -> Secret {
    derive(key, NOTIFY_LABEL)
}

pub fn letter(key: &[u8; 32]) -> Secret {
    derive(key, LETTER_LABEL)
}

fn derive(key: &[u8; 32], label: &[u8]) -> Secret {
    // HMAC accepts a key of any length, so this cannot fail.
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("hmac takes a 32-byte key");
    mac.update(label);
    Zeroizing::new(mac.finalize().into_bytes().into())
}
