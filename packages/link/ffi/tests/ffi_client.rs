mod common;

use std::ptr;

use broski_link_core::crypto::{StaticIdentity, PUBLIC_BUNDLE_LEN};
use broski_link_core::proto::Resume;
use broski_link_core::{Link, LinkEvent, CONFIG};
use broski_link_ffi::{
    bl_buf_free, bl_client_connect, bl_client_disconnect, bl_client_free, bl_client_handle,
    bl_client_handle_timeout, bl_client_new, bl_client_poll_event, bl_client_poll_timeout,
    bl_client_poll_transmit, bl_client_send, bl_last_error, BlClient,
};
use common::{client_secret, empty, poll_event, take, Event};

/// A paired client with the server-side core link it handshook with, session [9; 16].
fn paired() -> (*mut BlClient, Link, StaticIdentity) {
    let server = StaticIdentity::generate().expect("server");
    let (device, device_secret) = client_secret();
    let server_public = server.public().to_bytes();
    let pairing = [0x42u8; 32];
    // SAFETY: every buffer is live for the call; the caller frees the result.
    let client = unsafe {
        bl_client_new(
            device_secret.as_ptr(),
            device_secret.len(),
            server_public.as_ptr(),
            server_public.len(),
        )
    };
    assert!(!client.is_null());

    let mut msg1 = empty();
    // SAFETY: `pairing` and `msg1` are live for the call.
    assert_eq!(
        unsafe { bl_client_connect(client, pairing.as_ptr(), 1_000, &mut msg1) },
        0
    );
    let msg1 = take(msg1);
    assert_eq!(msg1.len(), 3_576, "3570-byte msg1 plus a 6-byte Hello");

    let accepted = Link::accept(&server, &msg1, || Some(pairing)).expect("msg1");
    assert_eq!(accepted.peer, device.public());
    let (mut server_link, msg2) = accepted.fresh(CONFIG, [9; 16], 1_000).expect("fresh");
    assert_eq!(
        server_link.poll_event(),
        Some(LinkEvent::Connected { resumed: false })
    );
    // SAFETY: `msg2` is live for the call.
    assert_eq!(
        unsafe { bl_client_handle(client, msg2.as_ptr(), msg2.len(), 1_000) },
        0
    );
    assert_eq!(poll_event(client), Some(Event::Connected(false)));
    assert!(unsafe { bl_client_poll_timeout(client) } > 0);
    (client, server_link, server)
}

#[test]
fn a_paired_client_moves_messages_both_ways() {
    let (client, mut server_link, _) = paired();

    // SAFETY: every argument is live for the call.
    assert_eq!(
        unsafe { bl_client_send(client, 1, b"hello".as_ptr(), 5, 1_000) },
        0
    );
    let mut wire = empty();
    // SAFETY: `wire` is writable for the call.
    assert_eq!(unsafe { bl_client_poll_transmit(client, &mut wire) }, 1);
    let wire = take(wire);
    server_link.handle_wire(&wire, 1_000).expect("deliver");
    assert_eq!(
        server_link.poll_event(),
        Some(LinkEvent::Message {
            stream: 1,
            bytes: b"hello".to_vec(),
        })
    );

    server_link.send(0, b"world", 1_000).expect("server send");
    let reply = server_link.poll_transmit().expect("seal").expect("queued");
    // SAFETY: `reply` is live for the call.
    assert_eq!(
        unsafe { bl_client_handle(client, reply.as_ptr(), reply.len(), 1_000) },
        0
    );
    assert_eq!(
        poll_event(client),
        Some(Event::Message(0, b"world".to_vec()))
    );

    // SAFETY: `client` came from bl_client_new and is freed once.
    unsafe { bl_client_free(client) };
}

#[test]
fn a_reconnect_resumes_the_same_session() {
    let (client, mut server_link, server) = paired();
    server_link.send(0, b"world", 1_000).expect("server send");
    let reply = server_link.poll_transmit().expect("seal").expect("queued");
    // SAFETY: `reply` is live for the call.
    assert_eq!(
        unsafe { bl_client_handle(client, reply.as_ptr(), reply.len(), 1_000) },
        0
    );
    assert_eq!(
        poll_event(client),
        Some(Event::Message(0, b"world".to_vec()))
    );

    // SAFETY: `client` is live for the call.
    unsafe { bl_client_disconnect(client) };
    assert_eq!(unsafe { bl_client_poll_timeout(client) }, -1);
    let mut msg1 = empty();
    // SAFETY: NULL selects Connect mode and `msg1` is writable.
    assert_eq!(
        unsafe { bl_client_connect(client, ptr::null(), 2_000, &mut msg1) },
        0
    );
    let msg1 = take(msg1);
    assert_eq!(msg1.len(), 3_570 + 30, "resuming Hello is 30 bytes");

    let mut accepted = Link::accept(&server, &msg1, || None).expect("msg1");
    assert_eq!(
        accepted.resume,
        Some(Resume {
            session_id: [9; 16],
            next_expected: 1,
        })
    );
    let msg2 = accepted.resume(&mut server_link, 2_000).expect("resume");
    // SAFETY: `msg2` is live for the call.
    assert_eq!(
        unsafe { bl_client_handle(client, msg2.as_ptr(), msg2.len(), 2_000) },
        0
    );
    assert_eq!(poll_event(client), Some(Event::Connected(true)));

    // SAFETY: `client` came from bl_client_new and is freed once.
    unsafe { bl_client_free(client) };
}

#[test]
fn a_client_rejects_wire_garbage() {
    let server = StaticIdentity::generate().expect("server");
    let (_, device_secret) = client_secret();
    let server_public = server.public().to_bytes();
    // SAFETY: every buffer is live for the call and the result is freed below.
    let client = unsafe {
        bl_client_new(
            device_secret.as_ptr(),
            device_secret.len(),
            server_public.as_ptr(),
            server_public.len(),
        )
    };
    assert!(!client.is_null());

    let mut buffer = empty();
    // SAFETY: Connect mode plus a writable output.
    assert_eq!(
        unsafe { bl_client_connect(client, ptr::null(), 0, &mut buffer) },
        0
    );
    let msg1 = take(buffer);
    let mut tampered = msg1.clone();
    tampered[40] ^= 0x40;
    // SAFETY: `tampered` is live for the call.
    assert_eq!(
        unsafe { bl_client_handle(client, tampered.as_ptr(), tampered.len(), 0) },
        -2
    );

    let mut message = empty();
    // SAFETY: `message` is writable for the call.
    assert_eq!(unsafe { bl_last_error(&mut message) }, 1);
    assert!(!take(message).is_empty());

    let (mut kind, mut stream, mut code) = (0u32, 0u32, 0u32);
    let mut bytes = empty();
    // SAFETY: every output is live; the client has no event to report.
    assert_eq!(
        unsafe { bl_client_poll_event(client, &mut kind, &mut stream, &mut code, &mut bytes) },
        0
    );

    // SAFETY: `client` came from bl_client_new and is freed once.
    unsafe { bl_client_free(client) };
}

#[test]
fn a_null_argument_is_rejected_without_writing() {
    let (_, device_secret) = client_secret();
    let server_public = vec![1u8; PUBLIC_BUNDLE_LEN];
    // SAFETY: both buffers are live for the call and the result is freed below.
    let client = unsafe {
        bl_client_new(
            device_secret.as_ptr(),
            device_secret.len(),
            server_public.as_ptr(),
            server_public.len(),
        )
    };
    assert!(!client.is_null());

    let mut kind = 7u32;
    let mut code = 0u32;
    let mut bytes = empty();
    // SAFETY: `stream` is deliberately NULL, the other outputs are live.
    assert_eq!(
        unsafe { bl_client_poll_event(client, &mut kind, ptr::null_mut(), &mut code, &mut bytes) },
        -1
    );
    assert_eq!(kind, 7, "a rejected call writes nothing");

    // SAFETY: every pointer is NULL or live; the library rejects the NULL ones.
    unsafe {
        assert_eq!(bl_client_poll_transmit(client, ptr::null_mut()), -1);
        assert_eq!(bl_client_poll_transmit(ptr::null_mut(), &mut bytes), -1);
        assert_eq!(bl_client_handle(ptr::null_mut(), ptr::null(), 0, 0), -1);
        assert_eq!(bl_client_send(ptr::null_mut(), 1, ptr::null(), 0, 0), -1);
        assert_eq!(bl_client_poll_timeout(ptr::null_mut()), -1);
        assert!(
            bl_client_new(ptr::null(), 0, server_public.as_ptr(), server_public.len()).is_null()
        );
        bl_client_handle_timeout(ptr::null_mut(), 0);
        bl_client_disconnect(ptr::null_mut());
        bl_client_free(ptr::null_mut());
        bl_buf_free(empty());
    }

    // SAFETY: `client` came from bl_client_new and is freed once.
    unsafe { bl_client_free(client) };
}
