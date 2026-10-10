mod common;

use broski_link_crypto::{Error, MAX_PLAINTEXT};
use common::{connect, open, seal};

#[test]
fn transport_is_bidirectional() {
    let mut session = connect(b"", b"");
    let to_responder = seal(&mut session.initiator_transport, b"from the phone");
    assert_eq!(
        open(&mut session.responder_transport, &to_responder).expect("open"),
        b"from the phone"
    );
    let to_initiator = seal(&mut session.responder_transport, b"from the machine");
    assert_eq!(
        open(&mut session.initiator_transport, &to_initiator).expect("open"),
        b"from the machine"
    );
}

#[test]
fn empty_messages_round_trip() {
    let mut session = connect(b"", b"");
    let ciphertext = seal(&mut session.initiator_transport, b"");
    assert_eq!(ciphertext.len(), 16);
    assert!(open(&mut session.responder_transport, &ciphertext)
        .expect("open")
        .is_empty());
}

#[test]
fn maximum_plaintext_round_trips() {
    let mut session = connect(b"", b"");
    let plaintext = vec![0xa5u8; MAX_PLAINTEXT];
    let ciphertext = seal(&mut session.initiator_transport, &plaintext);
    assert_eq!(ciphertext.len(), MAX_PLAINTEXT + 16);
    assert_eq!(
        open(&mut session.responder_transport, &ciphertext).expect("open"),
        plaintext
    );
}

#[test]
fn oversized_plaintext_is_rejected() {
    let mut session = connect(b"", b"");
    let mut out = vec![0u8; 4];
    let oversized = vec![0u8; MAX_PLAINTEXT + 1];
    assert!(matches!(
        session.initiator_transport.seal(&oversized, &mut out),
        Err(Error::PayloadTooLarge { .. })
    ));
    assert_eq!(out, vec![0u8; 4], "out was modified on failure");
}

#[test]
fn malformed_ciphertext_lengths_are_rejected() {
    let mut session = connect(b"", b"");
    let mut out = Vec::new();
    assert!(matches!(
        session.responder_transport.open(&[0u8; 15], &mut out),
        Err(Error::Malformed(_))
    ));
    assert!(matches!(
        session
            .responder_transport
            .open(&vec![0u8; 65_536], &mut out),
        Err(Error::MessageTooLarge { .. })
    ));
    assert!(out.is_empty(), "out was modified on failure");
}

#[test]
fn tampered_ciphertext_is_rejected() {
    let mut session = connect(b"", b"");
    let mut ciphertext = seal(&mut session.initiator_transport, b"secret");
    ciphertext[0] ^= 0x01;
    assert!(open(&mut session.responder_transport, &ciphertext).is_err());
}

#[test]
fn replayed_ciphertext_is_rejected() {
    let mut session = connect(b"", b"");
    let first = seal(&mut session.initiator_transport, b"first");
    let _second = seal(&mut session.initiator_transport, b"second");
    assert_eq!(
        open(&mut session.responder_transport, &first).expect("first open"),
        b"first"
    );
    assert!(open(&mut session.responder_transport, &first).is_err());
}

#[test]
fn ciphertext_from_another_session_is_rejected() {
    let mut other = connect(b"", b"");
    let mut session = connect(b"", b"");
    let ciphertext = seal(&mut other.initiator_transport, b"elsewhere");
    assert!(open(&mut session.responder_transport, &ciphertext).is_err());
}

#[test]
fn a_failed_open_does_not_desynchronise_the_stream() {
    let mut session = connect(b"", b"");
    let good = seal(&mut session.initiator_transport, b"good");
    assert!(open(&mut session.responder_transport, &[0u8; 32]).is_err());
    assert_eq!(
        open(&mut session.responder_transport, &good).expect("open"),
        b"good"
    );
}

#[test]
fn sealing_appends_after_existing_output() {
    let mut session = connect(b"", b"");
    let mut out = b"prefix".to_vec();
    session
        .initiator_transport
        .seal(b"payload", &mut out)
        .expect("seal");
    assert_eq!(&out[..6], b"prefix");

    let mut plain = b"prefix".to_vec();
    session
        .responder_transport
        .open(&out[6..], &mut plain)
        .expect("open");
    assert_eq!(&plain, b"prefixpayload");
}

#[test]
fn many_messages_stay_in_order() {
    let mut session = connect(b"", b"");
    for index in 0..64u32 {
        let plaintext = index.to_be_bytes();
        let ciphertext = seal(&mut session.initiator_transport, &plaintext);
        assert_eq!(
            open(&mut session.responder_transport, &ciphertext).expect("open"),
            plaintext
        );
    }
}
