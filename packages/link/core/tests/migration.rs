mod common;

use broski_link_core::{Error, Link, CONFIG};
use common::rand::random_bytes;
use common::Harness;

/// Sends one numbered message each way, sealed onto the current route.
fn exchange(h: &mut Harness, index: u64, up: &mut Vec<Vec<u8>>, down: &mut Vec<Vec<u8>>) {
    let (to_machine, to_phone) = (
        random_bytes(index, 3_000),
        random_bytes(index + 500, 90_000),
    );
    h.phone_send(1, &to_machine).expect("phone send");
    h.machine_send(1, &to_phone).expect("machine send");
    up.push(to_machine);
    down.push(to_phone);
    h.collect().expect("seal");
}

fn delivered(inbox: &mut Vec<(u32, Vec<u8>)>) -> Vec<Vec<u8>> {
    std::mem::take(inbox)
        .into_iter()
        .map(|(_, bytes)| bytes)
        .collect()
}

#[test]
fn a_migration_moves_the_session_onto_the_new_connection_without_loss() {
    let mut h = Harness::new(0x51_6E);
    h.pair().expect("pair");
    let (mut up, mut down) = (Vec::new(), Vec::new());
    for index in 0..4 {
        exchange(&mut h, index, &mut up, &mut down);
    }
    h.step().expect("some frames cross the old route");

    // msg1 leaves on the new connection while both sides keep using the old one.
    let msg1 = h
        .phone
        .link
        .migrate(&h.phone.identity, &h.phone.server)
        .expect("msg1");
    assert!(h.phone.link.is_migrating());
    exchange(&mut h, 10, &mut up, &mut down);
    h.step().expect("more frames cross the old route");

    let msg2 = h
        .machine
        .accept_hello(&msg1, h.now)
        .expect("accept")
        .expect("msg2");
    // The machine moved: whatever the phone sealed for the old connection is lost with it, and the
    // phone still reads what the machine sealed for it until msg2 arrives.
    h.to_machine.clear();
    if let Some(wire) = h.to_phone.pop_front() {
        h.phone.handle(&wire, h.now).expect("old route frame");
    }
    h.phone
        .link
        .complete_migration(&msg2, h.now)
        .expect("migrated");
    h.phone.collect();
    h.to_phone.clear();
    assert!(!h.phone.link.is_migrating());

    exchange(&mut h, 20, &mut up, &mut down);
    h.pump().expect("pump on the new connection");
    assert_eq!(h.phone.resumed, [false, true]);
    assert_eq!(h.machine.resumed, [false, true]);
    assert_eq!(
        delivered(&mut h.machine.inbox),
        up,
        "every message once, in order"
    );
    assert_eq!(
        delivered(&mut h.phone.inbox),
        down,
        "every message once, in order"
    );
    assert_eq!(h.phone.link.unacked_bytes(), 0);
}

#[test]
fn a_failed_migration_leaves_the_current_connection_carrying_the_session() {
    let mut h = Harness::new(0x51_6F);
    h.pair().expect("pair");
    let (mut up, mut down) = (Vec::new(), Vec::new());
    exchange(&mut h, 0, &mut up, &mut down);

    h.phone
        .link
        .migrate(&h.phone.identity, &h.phone.server)
        .expect("msg1");
    assert!(h
        .phone
        .link
        .complete_migration(b"not a msg2", h.now)
        .is_err());
    assert!(!h.phone.link.is_migrating());
    h.phone
        .link
        .migrate(&h.phone.identity, &h.phone.server)
        .expect("msg1");
    h.phone.link.abandon_migration();

    exchange(&mut h, 1, &mut up, &mut down);
    h.pump().expect("the old connection still works");
    assert_eq!(h.phone.resumed, [false]);
    assert_eq!(delivered(&mut h.machine.inbox), up);
    assert_eq!(delivered(&mut h.phone.inbox), down);
}

#[test]
fn a_migration_the_peer_answers_with_a_new_session_resets_it() {
    let mut h = Harness::new(0x51_70);
    h.pair().expect("pair");
    let previous = h.phone.link.session_id();
    let msg1 = h
        .phone
        .link
        .migrate(&h.phone.identity, &h.phone.server)
        .expect("msg1");
    h.machine.forget_sessions();
    let msg2 = h
        .machine
        .accept_hello(&msg1, h.now)
        .expect("accept")
        .expect("msg2");
    h.phone
        .link
        .complete_migration(&msg2, h.now)
        .expect("migrated");
    h.phone.collect();
    assert_eq!(h.phone.resumed, [false, false]);
    assert_ne!(h.phone.link.session_id(), previous);
    assert_eq!(h.phone.link.session_id(), h.machine.session_id());
}

#[test]
fn only_a_connected_open_link_migrates() {
    let mut h = Harness::new(0x51_71);
    let server = h.phone.server.clone();
    let mut idle = Link::client(CONFIG);
    assert!(matches!(
        idle.migrate(&h.phone.identity, &server),
        Err(Error::NotConnected)
    ));
    assert!(matches!(
        idle.complete_migration(b"x", h.now),
        Err(Error::NoMigration)
    ));

    h.pair().expect("pair");
    h.phone
        .link
        .migrate(&h.phone.identity, &server)
        .expect("msg1");
    h.phone.link.disconnect();
    assert!(
        !h.phone.link.is_migrating(),
        "a lost connection ends the migration too"
    );
    h.reconnect().expect("resume");
    h.phone.link.close(1000);
    assert!(matches!(
        h.phone.link.migrate(&h.phone.identity, &server),
        Err(Error::Closed)
    ));
}
