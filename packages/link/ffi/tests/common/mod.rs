#![allow(dead_code)]

use std::ptr;

use broski_link_core::crypto::StaticIdentity;
use broski_link_ffi::{bl_buf_free, bl_client_poll_event, BlBuf, BlClient};
use zeroize::Zeroizing;

pub fn empty() -> BlBuf {
    BlBuf {
        ptr: ptr::null_mut(),
        len: 0,
        cap: 0,
    }
}

pub fn take(blob: BlBuf) -> Vec<u8> {
    let bytes = match blob.len {
        0 => Vec::new(),
        len => {
            // SAFETY: `blob` came from this library, so ptr is non-null for len > 0.
            unsafe { std::slice::from_raw_parts(blob.ptr, len) }.to_vec()
        }
    };
    // SAFETY: `blob` is freed once, here.
    unsafe { bl_buf_free(blob) };
    bytes
}

#[derive(Debug, PartialEq, Eq)]
pub enum Event {
    Connected(bool),
    Message(u32, Vec<u8>),
    PeerClosed(u32),
    Dead,
}

pub fn poll_event(client: *mut BlClient) -> Option<Event> {
    let (mut kind, mut stream, mut code) = (0u32, 0u32, 0u32);
    let mut bytes = empty();
    // SAFETY: every pointer is live and writable for the call.
    let status =
        unsafe { bl_client_poll_event(client, &mut kind, &mut stream, &mut code, &mut bytes) };
    assert!(status >= 0, "poll_event failed with {status}");
    if status == 0 {
        return None;
    }
    let payload = take(bytes);
    Some(match kind {
        1 => Event::Connected(code == 1),
        2 => Event::Message(stream, payload),
        3 => Event::PeerClosed(code),
        4 => Event::Dead,
        other => panic!("unknown event kind {other}"),
    })
}

pub fn client_secret() -> (StaticIdentity, Zeroizing<Vec<u8>>) {
    let identity = StaticIdentity::generate().expect("identity");
    let secret = identity.to_secret_bytes();
    (identity, secret)
}
