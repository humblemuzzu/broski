mod common;

use broski_link_core::crypto::{HandshakeMode, HandshakeModeKind, StaticIdentity};
use broski_link_core::{Error, Link, CONFIG, STREAM_BRIDGE, STREAM_CONTROL};
use common::rand::random_bytes;
use common::{Delivered, Harness};

const SIZES: [usize; 4] = [0, 100, 70 * 1024, 3 * 1024 * 1024];
const STREAMS: [u32; 2] = [STREAM_CONTROL, STREAM_BRIDGE];

#[test]
fn pair_then_resume_carries_every_size_on_both_streams() {
    let mut h = Harness::new(7);
    h.pair().expect("pair");
    assert_eq!(h.phone.resumed, [false]);
    assert_eq!(h.machine.resumed, [false]);
    assert_eq!(h.phone.link.session_id(), h.machine.session_id());
    assert_eq!(h.phone.link.unacked_bytes(), 0);

    let (first_up, first_down) = exchange(&mut h, 1);
    h.drop_route();
    h.reconnect().expect("resume");
    assert_eq!(h.phone.resumed, [false, true]);
    assert_eq!(h.machine.resumed, [false, true]);
    assert_eq!(h.phone.link.session_id(), h.machine.session_id());
    let (second_up, second_down) = exchange(&mut h, 2);

    let mut up = first_up;
    up.extend(second_up);
    let mut down = first_down;
    down.extend(second_down);
    assert_eq!(std::mem::take(&mut h.machine.inbox), up);
    assert_eq!(std::mem::take(&mut h.phone.inbox), down);
    assert_eq!(h.phone.link.unacked_bytes(), 0);
    assert_eq!(h.machine.unacked_bytes(), 0);
}

#[test]
fn a_daemon_drops_the_accepted_handshake_of_an_unknown_device() {
    let mut h = Harness::new(3);
    let msg1 = h
        .phone
        .connect(HandshakeMode::Pair { secret: h.secret }, h.now)
        .expect("msg1");

    let pairing = h.machine.pairing;
    let accepted = Link::accept(&h.machine.identity, &msg1, || pairing).expect("read msg1");
    assert_eq!(accepted.mode, HandshakeModeKind::Pair);
    assert_eq!(accepted.peer, h.phone.identity.public());
    assert!(accepted.resume.is_none());

    let allowlist = [StaticIdentity::generate().expect("identity").public().id()];
    assert!(
        !allowlist.contains(&accepted.peer.id()),
        "the device is not on the daemon's allowlist"
    );
    drop(accepted);

    h.machine.allow = false;
    assert!(h
        .machine
        .accept_hello(&msg1, h.now)
        .expect("handshake reads")
        .is_none());
    assert_eq!(h.machine.rejected, 1);
    assert_eq!(h.machine.session_id(), None);
    assert_eq!(h.phone.link.session_id(), None);
    assert!(!h.phone.link.is_connected());
}

#[test]
fn a_first_handshake_has_nothing_to_resume() {
    let mut h = Harness::new(5);
    let msg1 = h
        .phone
        .connect(HandshakeMode::Pair { secret: h.secret }, h.now)
        .expect("msg1");
    let pairing = h.machine.pairing;
    let mut accepted = Link::accept(&h.machine.identity, &msg1, || pairing).expect("read msg1");
    assert!(accepted.resume.is_none());
    let mut link = Link::client(CONFIG);
    assert!(matches!(
        accepted.resume(&mut link, h.now),
        Err(Error::NoResumeOffer)
    ));
}

fn exchange(h: &mut Harness, seed: u64) -> (Delivered, Delivered) {
    let mut up = Vec::new();
    let mut down = Vec::new();
    for (index, size) in SIZES.iter().enumerate() {
        let stream = STREAMS[index % 2];
        let to_machine = random_bytes(seed * 100 + index as u64, *size);
        let to_phone = random_bytes(seed * 1_000 + index as u64, *size);
        h.phone_send(stream, &to_machine).expect("phone send");
        h.machine_send(stream, &to_phone).expect("machine send");
        up.push((stream, to_machine));
        down.push((stream, to_phone));
    }
    h.pump().expect("pump");
    (up, down)
}
