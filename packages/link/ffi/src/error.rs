use broski_link_core::proto::Error as ProtoError;
use broski_link_core::Error as LinkError;

use crate::buf::{into_blob, BlBuf};

pub const OK: i32 = 0;
pub const INVALID_ARGUMENT: i32 = -1;
pub const FAILED: i32 = -2;
pub const BACKPRESSURE: i32 = -3;
pub const PANIC: i32 = -99;

thread_local! {
    static LAST_ERROR: std::cell::RefCell<Option<Vec<u8>>> = const { std::cell::RefCell::new(None) };
}

pub fn invalid(message: &str) -> i32 {
    set_last_error(message);
    INVALID_ARGUMENT
}

pub fn fail(error: LinkError) -> i32 {
    set_last_error(&format!("{error}"));
    if matches!(error, LinkError::Proto(ProtoError::Backpressure { .. })) {
        BACKPRESSURE
    } else {
        FAILED
    }
}

pub(crate) fn set_last_error(message: &str) {
    LAST_ERROR.with(|slot| *slot.borrow_mut() = Some(message.as_bytes().to_vec()));
}

/// The FFI boundary: a panic is swallowed and reported as `fallback`.
pub fn caught<T>(fallback: T, body: impl FnOnce() -> T) -> T {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(body)) {
        Ok(value) => value,
        Err(_) => {
            set_last_error("panic");
            fallback
        }
    }
}

/// Returns the message of the last failing call on this thread: `1` and the
/// message were written, `0` means this thread has no error recorded.
///
/// # Safety
///
/// `out` must point to writable `BlBuf` storage.
#[no_mangle]
pub unsafe extern "C" fn bl_last_error(out: *mut BlBuf) -> i32 {
    caught(PANIC, || {
        if out.is_null() {
            return INVALID_ARGUMENT;
        }
        let message = LAST_ERROR.with(|slot| slot.borrow().clone());
        let Some(message) = message else {
            return 0;
        };
        // SAFETY: `out` is non-null and the caller guarantees a writable BlBuf.
        unsafe { out.write(into_blob(message)) };
        1
    })
}
