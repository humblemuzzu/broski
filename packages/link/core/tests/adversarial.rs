mod common;

use broski_link_core::crypto::{Error as CryptoError, HandshakeMode, StaticIdentity};
use broski_link_core::Error;
use common::{Harness, T0};

#[test]
fn a_flipped_bit_in_a_sealed_frame_is_rejected() {
    let mut h = Harness::new(11);
    h.pair().expect("pair");
    h.phone_send(1, b"hello").expect("send");
    h.collect().expect("seal");
    let wire = h.to_machine.pop_front().expect("a sealed frame");

    let mut tampered = wire.clone();
    tampered[0] ^= 0x01;
    assert!(matches!(
        h.machine.deliver(&tampered, h.now),
        Err(Error::Crypto(CryptoError::Transport(_)))
    ));
    h.machine
        .deliver(&wire, h.now)
        .expect("the counter survives");
    assert_eq!(
        std::mem::take(&mut h.machine.inbox),
        [(1, b"hello".to_vec())]
    );

    h.machine_send(1, b"reply").expect("send");
    h.collect().expect("seal");
    let mut wire = h.to_phone.pop_front().expect("a sealed frame");
    let last = wire.len() - 1;
    wire[last] ^= 0x80;
    assert!(matches!(
        h.phone.handle(&wire, h.now),
        Err(Error::Crypto(CryptoError::Transport(_)))
    ));
}

#[test]
fn a_peer_close_is_reported_and_stops_both_apps() {
    let mut h = Harness::new(19);
    h.pair().expect("pair");
    h.pump().expect("pump");

    h.machine.close(7);
    h.pump().expect("the close arrives");
    assert_eq!(h.phone.closed, [7]);
    assert!(matches!(
        h.phone.link.send(1, b"later", h.now),
        Err(Error::Closed)
    ));
    assert!(matches!(
        h.machine.send(1, b"later", h.now),
        Err(Error::Closed)
    ));
}

#[test]
fn a_frame_that_arrives_after_the_close_is_refused() {
    let mut h = Harness::new(23);
    h.pair().expect("pair");
    h.pump().expect("pump");

    h.phone.link.close(9);
    h.machine_send(1, b"in flight").expect("send");
    h.collect().expect("seal");
    let close = h.to_machine.pop_front().expect("the close frame");
    let in_flight = h.to_phone.pop_front().expect("the frame sent before it");

    h.machine.deliver(&close, h.now).expect("the close arrives");
    assert_eq!(h.machine.closed, [9]);
    assert!(matches!(
        h.phone.handle(&in_flight, h.now),
        Err(Error::Closed)
    ));
}

#[test]
fn a_message_minted_for_another_bundle_never_reaches_the_responder() {
    let mut h = Harness::new(13);
    h.phone.server = StaticIdentity::generate().expect("identity").public();
    let msg1 = h
        .phone
        .connect(HandshakeMode::Pair { secret: h.secret }, h.now)
        .expect("msg1");
    assert!(matches!(
        h.machine.accept_hello(&msg1, h.now),
        Err(Error::Crypto(CryptoError::Handshake(_)))
    ));
    assert_eq!(h.machine.session_id(), None);
}

#[test]
fn pair_mode_rejects_a_wrong_or_missing_secret() {
    let mut h = Harness::new(29);
    let mut wrong = h.secret;
    wrong[0] ^= 0xff;
    let msg1 = h
        .phone
        .connect(HandshakeMode::Pair { secret: wrong }, h.now)
        .expect("msg1");
    assert!(matches!(
        h.machine.accept_hello(&msg1, h.now),
        Err(Error::Crypto(CryptoError::Handshake(_)))
    ));

    h.machine.pairing = None;
    let msg1 = h
        .phone
        .connect(HandshakeMode::Pair { secret: h.secret }, h.now)
        .expect("msg1");
    assert!(matches!(
        h.machine.accept_hello(&msg1, h.now),
        Err(Error::Crypto(CryptoError::PairingSecretRequired))
    ));
    assert_eq!(h.machine.session_id(), None);
}

#[test]
fn a_ping_keeps_the_route_alive_and_silence_reports_dead() {
    let mut h = Harness::new(17);
    h.pair().expect("pair");
    h.pump().expect("pump");

    h.advance(15_001);
    h.pump().expect("ping and pong");
    assert_eq!(h.phone.dead, 0);
    assert_eq!(h.machine.dead, 0);
    assert!(h.phone.link.is_connected());
    assert!(h.machine.is_connected());

    h.advance(45_001);
    assert_eq!(h.phone.dead, 1);
    assert_eq!(h.machine.dead, 1);
}

#[test]
fn a_session_is_never_handed_out_before_it_exists() {
    let mut h = Harness::new(41);
    assert_eq!(h.phone.link.session_id(), None);
    assert_eq!(h.phone.link.unacked_bytes(), 0);
    assert!(matches!(
        h.phone.link.send(1, b"too early", T0),
        Err(Error::NoSession)
    ));
    assert!(h
        .phone
        .link
        .poll_transmit()
        .expect("nothing queued")
        .is_none());
    assert!(h
        .machine
        .deliver(b"straight onto the wire", T0)
        .is_err_and(|error| matches!(error, Error::NotConnected)));
}
