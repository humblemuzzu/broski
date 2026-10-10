mod common;

use broski_link_crypto::{
    Error, HandshakeMode, HandshakeModeKind, Initiator, Responder, StaticIdentity,
    MAX_HANDSHAKE_PAYLOAD,
};
use common::{connect, first_message, identities, open, seal};

const NOISE_MESSAGE_MAX: usize = 65_535;

#[test]
fn handshake_payloads_are_delivered() {
    let session = connect(b"phone hello", b"machine hello");
    assert_eq!(session.initiator_payload, b"phone hello");
    assert_eq!(session.responder_payload, b"machine hello");
}

#[test]
fn responder_recovers_the_initiator_static_bundle() {
    let (initiator, responder) = identities();
    let (_, msg1) = Initiator::start(&initiator, &responder.public(), HandshakeMode::Connect, b"")
        .expect("start");
    let (_, peer, _, _) = Responder::read_first(&responder, &msg1, || None).expect("read");
    assert_eq!(peer, initiator.public());
}

#[test]
fn empty_payloads_are_allowed() {
    let session = connect(b"", b"");
    assert!(session.initiator_payload.is_empty());
    assert!(session.responder_payload.is_empty());
}

#[test]
fn handshake_payload_limit_is_enforced() {
    let (initiator, responder) = identities();
    let bundle = responder.public();
    let payload = vec![7u8; MAX_HANDSHAKE_PAYLOAD];
    let (outgoing, msg1) =
        Initiator::start(&initiator, &bundle, HandshakeMode::Connect, &payload).expect("start");
    let (incoming, _, seen, _) =
        Responder::read_first(&responder, &msg1, || None).expect("read_first");
    assert_eq!(seen, payload);
    let (_, msg2) = incoming.reply(&payload).expect("reply");
    let (_, reply) = outgoing.finish(&msg2).expect("finish");
    assert_eq!(reply, payload);

    let oversized = vec![0u8; MAX_HANDSHAKE_PAYLOAD + 1];
    assert!(matches!(
        Initiator::start(&initiator, &bundle, HandshakeMode::Connect, &oversized),
        Err(Error::PayloadTooLarge { .. })
    ));

    let (_, msg1) =
        Initiator::start(&initiator, &bundle, HandshakeMode::Connect, b"").expect("start");
    let (incoming, _, _, _) = Responder::read_first(&responder, &msg1, || None).expect("read");
    assert!(matches!(
        incoming.reply(&oversized),
        Err(Error::PayloadTooLarge { .. })
    ));
}

#[test]
fn pair_succeeds_with_matching_secret() {
    let secret = [5u8; 32];
    let (mut initiator, mut responder) =
        common::pair(secret, Some(secret), b"pair", b"ok").expect("pair handshake");
    let ciphertext = seal(&mut initiator, b"secure");
    assert_eq!(open(&mut responder, &ciphertext).expect("open"), b"secure");
}

#[test]
fn pair_fails_with_mismatched_secret() {
    let result = common::pair([5u8; 32], Some([6u8; 32]), b"pair", b"ok");
    assert!(result.is_err(), "mismatched pairing secret completed");

    let (initiator, responder) = identities();
    let msg1 = first_message(
        &initiator,
        &responder.public(),
        HandshakeMode::Pair { secret: [5u8; 32] },
        b"payload",
    );
    assert!(
        Responder::read_first(&responder, &msg1, || Some([6u8; 32])).is_err(),
        "responder accepted a first message it cannot authenticate"
    );
}

#[test]
fn pair_fails_without_responder_secret() {
    let (initiator, responder) = identities();
    let msg1 = first_message(
        &initiator,
        &responder.public(),
        HandshakeMode::Pair { secret: [5u8; 32] },
        b"",
    );
    assert!(matches!(
        Responder::read_first(&responder, &msg1, || None),
        Err(Error::PairingSecretRequired)
    ));
}

#[test]
fn connect_does_not_consult_the_pairing_secret() {
    let (initiator, responder) = identities();
    let msg1 = first_message(&initiator, &responder.public(), HandshakeMode::Connect, b"");
    let (_, _, _, kind) =
        Responder::read_first(&responder, &msg1, || panic!("consulted")).expect("read");
    assert_eq!(kind, HandshakeModeKind::Connect);
}

#[test]
fn mode_byte_cannot_be_rewritten() {
    let (initiator, responder) = identities();
    let bundle = responder.public();

    let mut pair = first_message(
        &initiator,
        &bundle,
        HandshakeMode::Pair { secret: [5u8; 32] },
        b"payload",
    );
    pair[1] = 0;
    assert!(Responder::read_first(&responder, &pair, || Some([5u8; 32])).is_err());

    let mut plain = first_message(&initiator, &bundle, HandshakeMode::Connect, b"payload");
    plain[1] = 1;
    assert!(Responder::read_first(&responder, &plain, || Some([5u8; 32])).is_err());
}

#[test]
fn tampered_first_message_is_rejected() {
    let (initiator, responder) = identities();
    let mut msg1 = first_message(
        &initiator,
        &responder.public(),
        HandshakeMode::Connect,
        b"x",
    );
    let last = msg1.len() - 1;
    msg1[last] ^= 0x01;
    assert!(Responder::read_first(&responder, &msg1, || None).is_err());
}

#[test]
fn tampered_second_message_is_rejected() {
    let (initiator, responder) = identities();
    let (outgoing, msg1) = Initiator::start(
        &initiator,
        &responder.public(),
        HandshakeMode::Connect,
        b"x",
    )
    .expect("start");
    let (incoming, _, _, _) = Responder::read_first(&responder, &msg1, || None).expect("read");
    let (_, mut msg2) = incoming.reply(b"y").expect("reply");
    let last = msg2.len() - 1;
    msg2[last] ^= 0x01;
    assert!(outgoing.finish(&msg2).is_err());
}

#[test]
fn truncated_first_message_is_rejected() {
    let (initiator, responder) = identities();
    let msg1 = first_message(
        &initiator,
        &responder.public(),
        HandshakeMode::Connect,
        b"x",
    );
    for length in [0, 1, msg1.len() - 1] {
        assert!(
            Responder::read_first(&responder, &msg1[..length], || None).is_err(),
            "accepted {length} bytes"
        );
    }
}

#[test]
fn truncated_second_message_is_rejected() {
    for length in [0, 1] {
        let (initiator, responder) = identities();
        let (outgoing, msg1) = Initiator::start(
            &initiator,
            &responder.public(),
            HandshakeMode::Connect,
            b"x",
        )
        .expect("start");
        let (incoming, _, _, _) = Responder::read_first(&responder, &msg1, || None).expect("read");
        let (_, msg2) = incoming.reply(b"y").expect("reply");
        assert!(
            outgoing.finish(&msg2[..length]).is_err(),
            "accepted {length} bytes"
        );
    }
}

#[test]
fn header_validation_is_strict() {
    let (initiator, responder) = identities();
    let valid = first_message(&initiator, &responder.public(), HandshakeMode::Connect, b"");

    let mut version = valid.clone();
    version[0] = 2;
    assert!(matches!(
        Responder::read_first(&responder, &version, || None),
        Err(Error::UnsupportedVersion(2))
    ));

    let mut mode = valid;
    mode[1] = 9;
    assert!(matches!(
        Responder::read_first(&responder, &mode, || None),
        Err(Error::Malformed(_))
    ));
}

#[test]
fn oversized_first_message_is_rejected() {
    let (_, responder) = identities();
    let mut msg1 = vec![1u8, 0u8];
    msg1.resize(2 + NOISE_MESSAGE_MAX + 1, 0);
    assert!(matches!(
        Responder::read_first(&responder, &msg1, || None),
        Err(Error::MessageTooLarge { .. })
    ));
}

#[test]
fn oversized_second_message_is_rejected() {
    let (initiator, responder) = identities();
    let (outgoing, msg1) = Initiator::start(
        &initiator,
        &responder.public(),
        HandshakeMode::Connect,
        b"x",
    )
    .expect("start");
    let (incoming, _, _, _) = Responder::read_first(&responder, &msg1, || None).expect("read");
    drop(incoming);
    assert!(matches!(
        outgoing.finish(&vec![0u8; NOISE_MESSAGE_MAX + 1]),
        Err(Error::MessageTooLarge { .. })
    ));
}

#[test]
fn unpinned_responder_bundle_fails() {
    let (initiator, responder) = identities();
    let wrong = StaticIdentity::generate().expect("identity").public();
    let msg1 = first_message(&initiator, &wrong, HandshakeMode::Connect, b"x");
    assert!(Responder::read_first(&responder, &msg1, || None).is_err());
}
