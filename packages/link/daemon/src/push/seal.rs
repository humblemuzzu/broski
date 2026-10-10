use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce};
use serde::Serialize;

/// The decoded size the relay accepts in a push `data` field.
pub const MAX_DATA: usize = 3072;

/// The plaintext the phone decrypts; field order is the pinned wire order.
#[derive(Serialize, Clone, Copy)]
pub struct Notification<'a> {
    pub v: u8,
    pub kind: &'a str,
    pub title: &'a str,
    pub body: &'a str,
    pub machine: &'a str,
    pub backend: &'a str,
    pub session: &'a str,
    pub request: Option<&'a str>,
    pub at: u64,
}

/// `nonce(12) || ChaCha20-Poly1305-IETF(key, nonce, plaintext, aad)` with a random nonce.
pub fn seal(key: &[u8; 32], aad: &[u8], plaintext: &[u8]) -> Option<Vec<u8>> {
    let nonce = crate::clock::bytes::<NONCE>().ok()?;
    seal_with(key, &nonce, aad, plaintext)
}

pub fn seal_with(
    key: &[u8; 32],
    nonce: &[u8; NONCE],
    aad: &[u8],
    plaintext: &[u8],
) -> Option<Vec<u8>> {
    let cipher = ChaCha20Poly1305::new_from_slice(key).ok()?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .ok()?;
    let mut out = Vec::with_capacity(NONCE + ciphertext.len());
    out.extend_from_slice(nonce);
    out.extend_from_slice(&ciphertext);
    Some(out)
}

pub fn open(key: &[u8; 32], aad: &[u8], data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < NONCE + TAG {
        return None;
    }
    let (nonce, ciphertext) = data.split_at(NONCE);
    let cipher = ChaCha20Poly1305::new_from_slice(key).ok()?;
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .ok()
}

/// Serialises the notification, cutting `body` on a character boundary until the sealed payload
/// would fit `MAX_DATA`. `None` when even an empty body cannot.
pub fn encode(notification: &Notification<'_>) -> Option<Vec<u8>> {
    let limit = MAX_DATA - NONCE - TAG;
    let mut body = notification.body;
    for _ in 0..64 {
        let text = serde_json::to_vec(&Notification {
            body,
            ..*notification
        })
        .ok()?;
        if text.len() <= limit {
            return Some(text);
        }
        if body.is_empty() {
            return None;
        }
        let next = cut(body, body.len().saturating_sub(text.len() - limit + 1));
        if next.len() == body.len() {
            return None;
        }
        body = next;
    }
    None
}

const NONCE: usize = 12;
const TAG: usize = 16;

fn cut(text: &str, bytes: usize) -> &str {
    let mut end = bytes.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}
