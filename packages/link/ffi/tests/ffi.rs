mod common;

use std::ptr;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use broski_link_core::crypto::{PairingOffer, PublicBundle, PUBLIC_BUNDLE_LEN, SECRET_BYTES_LEN};
use broski_link_ffi::{
    bl_abi_version, bl_buf_free, bl_bundle_fingerprint, bl_bundle_id, bl_identity_generate,
    bl_identity_public, bl_last_error, bl_pairing_parse, bl_sha256,
};
use common::{empty, take};

#[test]
fn the_abi_is_version_two_and_sha256_still_hashes() {
    assert_eq!(bl_abi_version(), 2);
    let mut digest = [0u8; 32];
    let data = b"abc";
    // SAFETY: `data` and `digest` are live for the call.
    let status = unsafe { bl_sha256(data.as_ptr(), data.len(), digest.as_mut_ptr()) };
    assert_eq!(status, 0);
    assert_eq!(digest[0], 0xba);
    assert_eq!(digest[31], 0xad);
    // SAFETY: a NULL input is rejected before it is read.
    assert_eq!(
        unsafe { bl_sha256(ptr::null(), 0, digest.as_mut_ptr()) },
        -1
    );
}

#[test]
fn an_identity_round_trips_through_the_abi() {
    let mut secret = empty();
    let mut public = empty();
    // SAFETY: both outputs are live and writable for the call.
    assert_eq!(unsafe { bl_identity_generate(&mut secret, &mut public) }, 0);
    let secret_bytes = take(secret);
    let public_bytes = take(public);
    assert_eq!(secret_bytes.len(), SECRET_BYTES_LEN);
    assert_eq!(public_bytes.len(), PUBLIC_BUNDLE_LEN);
    assert_eq!(secret_bytes[0], 1, "the identity blob is version 1");
    assert_eq!(public_bytes[0], 1, "the public bundle is version 1");

    let mut derived = empty();
    // SAFETY: `secret_bytes` is live and `derived` is writable.
    let status =
        unsafe { bl_identity_public(secret_bytes.as_ptr(), secret_bytes.len(), &mut derived) };
    assert_eq!(status, 0);
    assert_eq!(take(derived), public_bytes);
}

#[test]
fn the_bundle_id_is_the_first_half_of_the_fingerprint() {
    let mut public = empty();
    let mut discard = empty();
    // SAFETY: both outputs are live and writable for the call.
    assert_eq!(
        unsafe { bl_identity_generate(&mut discard, &mut public) },
        0
    );
    let _ = take(discard);
    let public_bytes = take(public);
    let bundle = PublicBundle::from_bytes(&public_bytes).expect("bundle");

    let mut out_id = empty();
    // SAFETY: `public_bytes` is live and `out_id` is writable.
    let status = unsafe { bl_bundle_id(public_bytes.as_ptr(), public_bytes.len(), &mut out_id) };
    assert_eq!(status, 0);
    let id = String::from_utf8(take(out_id)).expect("utf8");
    assert_eq!(id, bundle.id());
    assert_eq!(id.len(), 32);
    assert!(id
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));

    let mut fingerprint = [0u8; 32];
    // SAFETY: `public_bytes` is live and `fingerprint` has 32 writable bytes.
    let status = unsafe {
        bl_bundle_fingerprint(
            public_bytes.as_ptr(),
            public_bytes.len(),
            fingerprint.as_mut_ptr(),
        )
    };
    assert_eq!(status, 0);
    assert_eq!(fingerprint, bundle.fingerprint());
    assert_eq!(id, hex(&fingerprint[..16]));

    let mut via_sha = [0u8; 32];
    // SAFETY: `public_bytes` is live and `via_sha` has 32 writable bytes.
    unsafe {
        bl_sha256(
            public_bytes.as_ptr(),
            public_bytes.len(),
            via_sha.as_mut_ptr(),
        )
    };
    assert_eq!(fingerprint, via_sha);
}

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

#[test]
fn a_pairing_offer_becomes_json() {
    let mut fingerprint = [0u8; 32];
    let mut secret = [0u8; 32];
    for (index, byte) in fingerprint.iter_mut().enumerate() {
        *byte = index as u8;
    }
    for (index, byte) in secret.iter_mut().enumerate() {
        *byte = 255 - index as u8;
    }
    let offer = PairingOffer {
        fingerprint,
        secret,
        relay: Some("wss://relay.example/x".to_string()),
        lan: vec!["10.0.0.2:8765".to_string(), "mac.local:9000".to_string()],
        name: "Broski \"Mac\"\n".to_string(),
        expires_at: 1_800_000_000,
    };
    let uri = offer.to_uri();
    let mut json = empty();
    // SAFETY: `uri` is live and `json` is writable.
    let status = unsafe { bl_pairing_parse(uri.as_ptr(), uri.len(), &mut json) };
    assert_eq!(status, 0);
    let json = String::from_utf8(take(json)).expect("utf8");
    let expected = format!(
        "{{\"fingerprint\":\"{}\",\"secret\":\"{}\",\"relay\":\"wss://relay.example/x\",\
         \"lan\":[\"10.0.0.2:8765\",\"mac.local:9000\"],\"name\":\"Broski \\\"Mac\\\"\\n\",\
         \"expires_at\":1800000000}}",
        URL_SAFE_NO_PAD.encode(fingerprint),
        URL_SAFE_NO_PAD.encode(secret),
    );
    assert_eq!(json, expected);
}

#[test]
fn invalid_arguments_are_rejected() {
    let mut out = empty();
    // SAFETY: every call below either takes NULL or live storage; the library
    // rejects the NULL arguments without reading them.
    unsafe {
        assert_eq!(bl_identity_public(ptr::null(), 0, &mut out), -1);
        assert_eq!(bl_identity_public(b"short".as_ptr(), 5, &mut out), -1);
        assert_eq!(bl_bundle_id(ptr::null(), 0, &mut out), -1);
        assert_eq!(bl_bundle_fingerprint(ptr::null(), 0, ptr::null_mut()), -1);
        let mut future_version = vec![0u8; PUBLIC_BUNDLE_LEN];
        future_version[0] = 2;
        assert_eq!(
            bl_bundle_id(future_version.as_ptr(), future_version.len(), &mut out),
            -2,
            "the right length with a version this build does not know"
        );
        assert_eq!(bl_identity_generate(ptr::null_mut(), &mut out), -1);
        assert_eq!(bl_pairing_parse(b"nope".as_ptr(), 4, &mut out), -2);
        assert_eq!(
            bl_pairing_parse(b"broski://pair?v=2".as_ptr(), 16, &mut out),
            -2
        );
        assert_eq!(bl_pairing_parse(b"\xff\xfe".as_ptr(), 2, &mut out), -1);
        bl_buf_free(empty());
    }
}

#[test]
fn the_last_error_of_a_failing_call_is_readable() {
    // SAFETY: the call fails on its NULL output before anything is written.
    let status = unsafe { bl_identity_public(b"short".as_ptr(), 5, ptr::null_mut()) };
    assert_eq!(status, -1);
    let mut message = empty();
    // SAFETY: `message` is writable for the call.
    assert_eq!(unsafe { bl_last_error(&mut message) }, 1);
    let message = String::from_utf8(take(message)).expect("utf8");
    assert!(message.contains("null"), "unexpected message: {message}");
}
