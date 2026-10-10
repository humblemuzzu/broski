use broski_link_core::crypto::{PublicBundle, StaticIdentity, PUBLIC_BUNDLE_LEN, SECRET_BYTES_LEN};
use zeroize::Zeroizing;

use crate::buf::{borrow, into_blob, BlBuf};
use crate::error::{caught, fail, invalid, OK, PANIC};

/// # Safety
///
/// Both outputs must point to writable `BlBuf` storage.
#[no_mangle]
pub unsafe extern "C" fn bl_identity_generate(
    out_secret: *mut BlBuf,
    out_public: *mut BlBuf,
) -> i32 {
    caught(PANIC, || {
        if out_secret.is_null() || out_public.is_null() {
            return invalid("bl_identity_generate needs both outputs");
        }
        let identity = match StaticIdentity::generate() {
            Ok(identity) => identity,
            Err(error) => return fail(error.into()),
        };
        let mut secret = identity.to_secret_bytes();
        let public = identity.public().to_bytes().to_vec();
        // SAFETY: both outputs are non-null and the caller guarantees writable BlBufs.
        unsafe {
            out_secret.write(into_blob(std::mem::take(&mut *secret)));
            out_public.write(into_blob(public));
        }
        OK
    })
}

/// # Safety
///
/// `secret` must point to `len` readable bytes, `out_public` to writable
/// `BlBuf` storage.
#[no_mangle]
pub unsafe extern "C" fn bl_identity_public(
    secret: *const u8,
    len: usize,
    out_public: *mut BlBuf,
) -> i32 {
    caught(PANIC, || {
        // SAFETY: the caller guarantees `len` readable bytes at `secret`.
        let Some(bytes) = (unsafe { borrow(secret, len) }) else {
            return invalid("secret must not be null");
        };
        if out_public.is_null() {
            return invalid("out_public must not be null");
        }
        if bytes.len() != SECRET_BYTES_LEN {
            return invalid("an identity secret is 3617 bytes");
        }
        let secret = Zeroizing::new(bytes.to_vec());
        let identity = match StaticIdentity::from_secret_bytes(&secret) {
            Ok(identity) => identity,
            Err(error) => return fail(error.into()),
        };
        // SAFETY: `out_public` is non-null and the caller guarantees a writable BlBuf.
        unsafe { out_public.write(into_blob(identity.public().to_bytes().to_vec())) };
        OK
    })
}

/// # Safety
///
/// `public` must point to `len` readable bytes, `out_id` to writable `BlBuf`
/// storage.
#[no_mangle]
pub unsafe extern "C" fn bl_bundle_id(public: *const u8, len: usize, out_id: *mut BlBuf) -> i32 {
    caught(PANIC, || {
        let bundle = match read_bundle(public, len) {
            Ok(bundle) => bundle,
            Err(code) => return code,
        };
        if out_id.is_null() {
            return invalid("out_id must not be null");
        }
        // SAFETY: `out_id` is non-null and the caller guarantees a writable BlBuf.
        unsafe { out_id.write(into_blob(bundle.id().into_bytes())) };
        OK
    })
}

/// # Safety
///
/// `public` must point to `len` readable bytes, `out32` to 32 writable bytes.
#[no_mangle]
pub unsafe extern "C" fn bl_bundle_fingerprint(
    public: *const u8,
    len: usize,
    out32: *mut u8,
) -> i32 {
    caught(PANIC, || {
        let bundle = match read_bundle(public, len) {
            Ok(bundle) => bundle,
            Err(code) => return code,
        };
        if out32.is_null() {
            return invalid("out32 must not be null");
        }
        let fingerprint = bundle.fingerprint();
        // SAFETY: `out32` is non-null and the caller guarantees 32 writable bytes.
        unsafe { std::slice::from_raw_parts_mut(out32, 32) }.copy_from_slice(&fingerprint);
        OK
    })
}

fn read_bundle(public: *const u8, len: usize) -> Result<PublicBundle, i32> {
    if len != PUBLIC_BUNDLE_LEN {
        return Err(invalid("a public bundle is 1217 bytes"));
    }
    // SAFETY: `len` equals PUBLIC_BUNDLE_LEN and the caller guarantees that many
    // readable bytes at `public`.
    let Some(bytes) = (unsafe { borrow(public, len) }) else {
        return Err(invalid("the bundle must not be null"));
    };
    PublicBundle::from_bytes(bytes).map_err(|error| fail(error.into()))
}
