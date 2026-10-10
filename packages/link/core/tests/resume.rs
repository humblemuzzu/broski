mod common;

use broski_link_core::crypto::{HandshakeMode, Initiator};
use broski_link_core::proto::{Error as ProtoError, Hello, Resume, Welcome};
use broski_link_core::{Error, Link, CONFIG};
use common::rand::{random_bytes, Rng};
use common::Harness;

#[test]
fn thirty_route_switches_keep_both_directions_exact() {
    let mut h = Harness::new(0xB0B5_1234);
    h.pair().expect("pair");
    let mut rng = Rng::new(0xB0B5_1234);
    let mut sent_up = Vec::new();
    let mut sent_down = Vec::new();
    let mut switches = 0;

    for index in 0..120 {
        let stream = rng.below(2) as u32;
        let up = random_bytes(1_000 + index as u64, rng.below(80_000) as usize);
        let down = random_bytes(2_000 + index as u64, rng.below(80_000) as usize);
        h.phone_send(stream, &up).expect("phone send");
        h.machine_send(stream, &down).expect("machine send");
        sent_up.push((stream, up));
        sent_down.push((stream, down));

        if index % 4 == 3 {
            h.collect().expect("seal");
            let pending = (h.to_machine.len() + h.to_phone.len()) as u64;
            for _ in 0..rng.below(pending + 1) {
                h.step().expect("deliver");
            }
            h.drop_route();
            h.reconnect().expect("resume");
            switches += 1;
        } else {
            h.pump().expect("pump");
        }
    }
    h.pump().expect("pump");

    assert_eq!(switches, 30);
    assert_eq!(std::mem::take(&mut h.machine.inbox), sent_up);
    assert_eq!(std::mem::take(&mut h.phone.inbox), sent_down);
    assert_eq!(h.phone.resumed.len(), 31);
    assert!(
        !h.phone.resumed[0],
        "the first connection starts the session"
    );
    assert!(h.phone.resumed[1..].iter().all(|resumed| *resumed));
    assert_eq!(h.machine.resumed, h.phone.resumed);
    assert_eq!(h.phone.link.unacked_bytes(), 0);
    assert_eq!(h.machine.unacked_bytes(), 0);
}

#[test]
fn a_forgotten_server_session_makes_the_client_resync() {
    let mut h = Harness::new(21);
    h.pair().expect("pair");
    h.phone_send(1, b"before").expect("send");
    h.pump().expect("pump");
    assert_eq!(
        std::mem::take(&mut h.machine.inbox),
        [(1, b"before".to_vec())]
    );
    let previous = h.phone.link.session_id().expect("session");

    h.drop_route();
    h.machine.forget_sessions();
    h.phone_send(1, b"queued for the dead session")
        .expect("send");
    h.reconnect().expect("fresh");
    h.pump().expect("pump");

    assert_eq!(h.phone.resumed, [false, false]);
    assert_eq!(h.machine.resumed, [false, false]);
    assert!(h.machine.inbox.is_empty(), "queued data is dropped");
    assert_ne!(h.phone.link.session_id(), Some(previous));
    assert_eq!(h.phone.link.session_id(), h.machine.session_id());

    h.phone_send(1, b"after").expect("send");
    h.pump().expect("pump");
    assert_eq!(
        std::mem::take(&mut h.machine.inbox),
        [(1, b"after".to_vec())]
    );
}

#[test]
fn a_resume_claim_past_what_was_sent_is_refused_then_fresh_answers() {
    let mut h = Harness::new(31);
    h.pair().expect("pair");
    let session_id = h.machine.session_id().expect("session");

    let claim = Hello {
        resume: Some(Resume {
            session_id,
            next_expected: 9_999,
        }),
        caps: 0,
    };
    let (initiator, msg1) = Initiator::start(
        &h.phone.identity,
        &h.machine.public(),
        HandshakeMode::Connect,
        &claim.encode(),
    )
    .expect("msg1");
    let mut accepted =
        Link::accept(&h.machine.identity, &msg1, || None).expect("the peer is authenticated");
    assert_eq!(accepted.resume, claim.resume);

    let link = h.machine.link_for(session_id).expect("the session");
    assert!(matches!(
        accepted.resume(link, h.now),
        Err(Error::Proto(ProtoError::ResumeMismatch { .. }))
    ));

    let mut stranger = Link::client(CONFIG);
    assert!(matches!(
        accepted.resume(&mut stranger, h.now),
        Err(Error::SessionMismatch)
    ));
    assert!(!stranger.is_connected());

    let (fresh, msg2) = accepted.fresh(CONFIG, [0xAB; 16], h.now).expect("fresh");
    assert_eq!(fresh.session_id(), Some([0xAB; 16]));
    assert!(fresh.is_connected());
    let (_, payload) = initiator.finish(&msg2).expect("msg2");
    let welcome = Welcome::decode(&payload).expect("welcome");
    assert!(!welcome.resumed);
    assert_eq!(welcome.session_id, [0xAB; 16]);
    assert_eq!(welcome.caps, 0);
}
