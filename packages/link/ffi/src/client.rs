use std::ptr;

use broski_link_core::crypto::{
    HandshakeMode, PublicBundle, StaticIdentity, PUBLIC_BUNDLE_LEN, SECRET_BYTES_LEN,
};
use broski_link_core::{Link, LinkEvent, CONFIG};
use zeroize::Zeroizing;

use crate::buf::{borrow, into_blob, BlBuf};
use crate::error::{caught, fail, invalid, OK, PANIC};

pub struct BlClient {
    link: Link,
    identity: StaticIdentity,
    server: PublicBundle,
}

/// # Safety
///
/// `secret` and `server_public` must point to `secret_len` and `public_len`
/// readable bytes. The result must be freed with [`bl_client_free`].
#[no_mangle]
pub unsafe extern "C" fn bl_client_new(
    secret: *const u8,
    secret_len: usize,
    server_public: *const u8,
    public_len: usize,
) -> *mut BlClient {
    caught(ptr::null_mut(), || {
        if secret_len != SECRET_BYTES_LEN || public_len != PUBLIC_BUNDLE_LEN {
            return null_client("an identity secret is 3617 bytes, a bundle 1217");
        }
        // SAFETY: both lengths were checked above and the caller guarantees that
        // many readable bytes at each pointer.
        let (secret_bytes, public_bytes) = unsafe {
            (
                borrow(secret, secret_len),
                borrow(server_public, public_len),
            )
        };
        let (Some(secret_bytes), Some(public_bytes)) = (secret_bytes, public_bytes) else {
            return null_client("the secret and the bundle must not be null");
        };
        let secret = Zeroizing::new(secret_bytes.to_vec());
        let identity = match StaticIdentity::from_secret_bytes(&secret) {
            Ok(identity) => identity,
            Err(error) => return null_client(&error.to_string()),
        };
        let server = match PublicBundle::from_bytes(public_bytes) {
            Ok(server) => server,
            Err(error) => return null_client(&error.to_string()),
        };
        Box::into_raw(Box::new(BlClient {
            link: Link::client(CONFIG),
            identity,
            server,
        }))
    })
}

/// # Safety
///
/// `client` must be a live pointer from [`bl_client_new`], freed exactly once.
#[no_mangle]
pub unsafe extern "C" fn bl_client_free(client: *mut BlClient) {
    caught((), || {
        if client.is_null() {
            return;
        }
        // SAFETY: `client` came from bl_client_new and is freed exactly once.
        drop(unsafe { Box::from_raw(client) });
    });
}

/// # Safety
///
/// `client` must be live; `pairing_secret32` is either NULL or 32 readable
/// bytes; `out_msg1` must be writable `BlBuf` storage.
#[no_mangle]
pub unsafe extern "C" fn bl_client_connect(
    client: *mut BlClient,
    pairing_secret32: *const u8,
    // kept in the ABI for the phone's clock; the handshake itself is clock-free
    _now_ms: u64,
    out_msg1: *mut BlBuf,
) -> i32 {
    caught(PANIC, || {
        let Some(client) = (unsafe { client.as_mut() }) else {
            return invalid("client must not be null");
        };
        if out_msg1.is_null() {
            return invalid("out_msg1 must not be null");
        }
        let mode = if pairing_secret32.is_null() {
            HandshakeMode::Connect
        } else {
            // SAFETY: the caller guarantees 32 readable bytes at `pairing_secret32`.
            HandshakeMode::Pair {
                secret: unsafe { *(pairing_secret32 as *const [u8; 32]) },
            }
        };
        match client.link.connect(&client.identity, &client.server, mode) {
            Ok(msg1) => {
                // SAFETY: `out_msg1` is non-null and the caller guarantees a writable BlBuf.
                unsafe { out_msg1.write(into_blob(msg1)) };
                OK
            }
            Err(error) => fail(error),
        }
    })
}

/// # Safety
///
/// `client` must be live and `data` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn bl_client_handle(
    client: *mut BlClient,
    data: *const u8,
    len: usize,
    now_ms: u64,
) -> i32 {
    caught(PANIC, || {
        let Some(client) = (unsafe { client.as_mut() }) else {
            return invalid("client must not be null");
        };
        // SAFETY: the caller guarantees `len` readable bytes at `data`.
        let Some(data) = (unsafe { borrow(data, len) }) else {
            return invalid("data must not be null");
        };
        match client.link.handle_wire(data, now_ms) {
            Ok(()) => OK,
            Err(error) => fail(error),
        }
    })
}

/// # Safety
///
/// `client` must be live and `data` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn bl_client_send(
    client: *mut BlClient,
    stream: u32,
    data: *const u8,
    len: usize,
    now_ms: u64,
) -> i32 {
    caught(PANIC, || {
        let Some(client) = (unsafe { client.as_mut() }) else {
            return invalid("client must not be null");
        };
        // SAFETY: the caller guarantees `len` readable bytes at `data`.
        let Some(data) = (unsafe { borrow(data, len) }) else {
            return invalid("data must not be null");
        };
        match client.link.send(stream, data, now_ms) {
            Ok(()) => OK,
            Err(error) => fail(error),
        }
    })
}

/// # Safety
///
/// `client` must be live and `out` must be writable `BlBuf` storage.
#[no_mangle]
pub unsafe extern "C" fn bl_client_poll_transmit(client: *mut BlClient, out: *mut BlBuf) -> i32 {
    caught(PANIC, || {
        let Some(client) = (unsafe { client.as_mut() }) else {
            return invalid("client must not be null");
        };
        if out.is_null() {
            return invalid("out must not be null");
        }
        match client.link.poll_transmit() {
            Ok(Some(wire)) => {
                // SAFETY: `out` is non-null and the caller guarantees a writable BlBuf.
                unsafe { out.write(into_blob(wire)) };
                1
            }
            Ok(None) => 0,
            Err(error) => fail(error),
        }
    })
}

/// # Safety
///
/// `client` must be live and all four outputs must point to writable storage.
#[no_mangle]
pub unsafe extern "C" fn bl_client_poll_event(
    client: *mut BlClient,
    kind: *mut u32,
    stream: *mut u32,
    code: *mut u32,
    out_bytes: *mut BlBuf,
) -> i32 {
    caught(PANIC, || {
        let Some(client) = (unsafe { client.as_mut() }) else {
            return invalid("client must not be null");
        };
        if kind.is_null() || stream.is_null() || code.is_null() || out_bytes.is_null() {
            return invalid("every output of bl_client_poll_event is required");
        }
        let Some(event) = client.link.poll_event() else {
            return 0;
        };
        let (event_kind, event_stream, event_code, bytes) = match event {
            LinkEvent::Connected { resumed } => (1, 0, u32::from(resumed), Vec::new()),
            LinkEvent::Message { stream, bytes } => (2, stream, 0, bytes),
            LinkEvent::PeerClosed(code) => (3, 0, u32::from(code), Vec::new()),
            LinkEvent::Dead => (4, 0, 0, Vec::new()),
        };
        // SAFETY: all four outputs are non-null and the caller guarantees writable storage.
        unsafe {
            kind.write(event_kind);
            stream.write(event_stream);
            code.write(event_code);
            out_bytes.write(into_blob(bytes));
        }
        1
    })
}

/// # Safety
///
/// `client` must be live.
#[no_mangle]
pub unsafe extern "C" fn bl_client_poll_timeout(client: *mut BlClient) -> i64 {
    caught(-1, || {
        let Some(client) = (unsafe { client.as_mut() }) else {
            return -1;
        };
        match client.link.poll_timeout() {
            Some(deadline) => deadline.min(i64::MAX as u64) as i64,
            None => -1,
        }
    })
}

/// # Safety
///
/// `client` must be live.
#[no_mangle]
pub unsafe extern "C" fn bl_client_handle_timeout(client: *mut BlClient, now_ms: u64) {
    caught((), || {
        if let Some(client) = unsafe { client.as_mut() } {
            client.link.handle_timeout(now_ms);
        }
    });
}

/// # Safety
///
/// `client` must be live.
#[no_mangle]
pub unsafe extern "C" fn bl_client_disconnect(client: *mut BlClient) {
    caught((), || {
        if let Some(client) = unsafe { client.as_mut() } {
            client.link.disconnect();
        }
    });
}

fn null_client(message: &str) -> *mut BlClient {
    crate::error::set_last_error(message);
    ptr::null_mut()
}
