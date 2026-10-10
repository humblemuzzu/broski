use crate::error::caught;

#[repr(C)]
#[derive(Debug)]
pub struct BlBuf {
    pub ptr: *mut u8,
    pub len: usize,
    pub cap: usize,
}

pub const EMPTY: BlBuf = BlBuf {
    ptr: std::ptr::null_mut(),
    len: 0,
    cap: 0,
};

pub fn into_blob(mut bytes: Vec<u8>) -> BlBuf {
    if bytes.is_empty() {
        return EMPTY;
    }
    bytes.shrink_to_fit();
    let blob = BlBuf {
        ptr: bytes.as_mut_ptr(),
        len: bytes.len(),
        cap: bytes.capacity(),
    };
    std::mem::forget(bytes);
    blob
}

/// # Safety
///
/// `buf` must be a live `BlBuf` from [`into_blob`], freed exactly once.
pub unsafe fn from_blob(buf: BlBuf) -> Vec<u8> {
    // SAFETY: the caller guarantees `buf` is one live allocation from `into_blob`.
    unsafe { Vec::from_raw_parts(buf.ptr, buf.len, buf.cap) }
}

/// # Safety
///
/// `ptr` must point to `len` readable bytes, or be NULL when `len` is 0.
pub unsafe fn borrow<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if len == 0 {
        return Some(&[]);
    }
    if ptr.is_null() {
        return None;
    }
    // SAFETY: the caller guarantees `len` readable bytes at `ptr`.
    Some(unsafe { std::slice::from_raw_parts(ptr, len) })
}

/// # Safety
///
/// `buf` must be a `BlBuf` this library returned and that has not been freed.
#[no_mangle]
pub unsafe extern "C" fn bl_buf_free(buf: BlBuf) {
    caught((), || {
        if buf.ptr.is_null() {
            return;
        }
        // SAFETY: `buf` came from `into_blob`; the NULL/empty case returned above.
        drop(unsafe { from_blob(buf) });
    });
}
