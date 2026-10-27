//! The C ABI the phone calls: identity, QR parsing and one link client.
#![deny(unsafe_op_in_unsafe_fn)]

mod buf;
mod client;
mod error;
mod identity;
mod pairing;

use sha2::{Digest, Sha256};

use crate::error::{caught, PANIC};

pub use buf::{bl_buf_free, BlBuf};
pub use client::{
    bl_client_connect, bl_client_disconnect, bl_client_free, bl_client_handle,
    bl_client_handle_timeout, bl_client_new, bl_client_poll_event, bl_client_poll_timeout,
    bl_client_poll_transmit, bl_client_send, BlClient,
};
pub use error::bl_last_error;
pub use identity::{bl_bundle_fingerprint, bl_bundle_id, bl_identity_generate, bl_identity_public};
pub use pairing::bl_pairing_parse;

const ABI_VERSION: u32 = 3;

#[no_mangle]
pub extern "C" fn bl_abi_version() -> u32 {
    caught(ABI_VERSION, || ABI_VERSION)
}

/// Writes `SHA256(data[..len])` into `out32`.
///
/// # Safety
///
/// `data` must point to `len` readable bytes, and `out32` to 32 writable bytes.
#[no_mangle]
pub unsafe extern "C" fn bl_sha256(data: *const u8, len: usize, out32: *mut u8) -> i32 {
    caught(PANIC, || {
        if data.is_null() || out32.is_null() {
            return -1;
        }
        // SAFETY: `data` is non-null and the caller guarantees `len` readable bytes.
        let input = unsafe { std::slice::from_raw_parts(data, len) };
        let digest = Sha256::digest(input);
        // SAFETY: `out32` is non-null and the caller guarantees 32 writable bytes;
        // `digest` is 32 bytes.
        unsafe { std::ptr::copy_nonoverlapping(digest.as_ptr(), out32, digest.len()) };
        0
    })
}
