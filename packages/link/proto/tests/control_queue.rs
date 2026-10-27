mod common;

use broski_link_proto::{Config, Kind, Session};
use common::{decode_frame, poll_frame, take};

const FLOOD: usize = 512;

fn session() -> Session {
    let mut session = Session::new([7u8; 16], Config::default());
    session.attach(0, 0).expect("attach");
    session
}

fn ping(ack: u64) -> Vec<u8> {
    broski_link_proto::Frame::control(Kind::Ping, ack, &[]).encode()
}

#[test]
fn a_ping_flood_does_not_grow_the_control_queue_without_bound() {
    let mut session = session();
    for _ in 0..FLOOD {
        session
            .handle_frame(&ping(0), 0)
            .expect("a ping is never an error");
    }
    let queued = take(&mut session);
    assert!(
        queued.len() < FLOOD,
        "every ping was answered: {} frames queued",
        queued.len()
    );
    assert!(
        !queued.is_empty(),
        "the session must still answer the first pings"
    );
    assert!(
        queued
            .iter()
            .all(|frame| decode_frame(frame).kind == Kind::Pong),
        "a ping is only ever answered with a pong"
    );
}

#[test]
fn a_bounded_queue_still_sends_the_close_frame() {
    let mut session = session();
    for _ in 0..FLOOD {
        session.handle_frame(&ping(0), 0).expect("a ping");
    }
    session.close(4003);
    let frames = take(&mut session);
    let last = frames.last().expect("a close frame");
    assert_eq!(decode_frame(last).kind, Kind::Close);
    assert_eq!(decode_frame(last).payload, 4003u16.to_be_bytes());
}

#[test]
fn a_queue_with_room_answers_every_ping() {
    let mut session = session();
    for _ in 0..4 {
        session.handle_frame(&ping(0), 0).expect("a ping");
    }
    let first = poll_frame(&mut session);
    assert_eq!(decode_frame(&first).kind, Kind::Pong);
    assert_eq!(take(&mut session).len(), 3);
}
