mod common;

use broski_link_proto::{Config, Event, Frame, Kind, Session};
use common::{decode_frame, messages, poll_frame, T0};

fn attached(config: Config) -> Session {
    let mut session = Session::new([1; 16], config);
    session.attach(0, T0).expect("attach");
    session
}

fn data(stream: u32, seq: u64, payload: &[u8]) -> Vec<u8> {
    Frame {
        kind: Kind::Data,
        flags: 0,
        stream,
        seq,
        ack: 0,
        payload,
    }
    .encode()
}

fn no_standalone_acks(config: Config) -> Config {
    Config {
        ack_every_frames: 16,
        ack_every_bytes: usize::MAX,
        ack_delay_ms: 10_000,
        ..config
    }
}

#[test]
fn a_below_threshold_frame_waits_for_the_delay() {
    let mut session = attached(Config::default());
    session.handle_frame(&data(1, 0, b"x"), T0).expect("data");
    assert!(session.poll_transmit().is_none(), "below every threshold");
    assert_eq!(session.poll_timeout(), Some(T0 + 25));
    session.handle_timeout(T0 + 24);
    assert!(session.poll_transmit().is_none());
    session.handle_timeout(T0 + 25);
    let ack = decode_frame(&poll_frame(&mut session));
    assert_eq!(ack.kind, Kind::Ack);
    assert_eq!(ack.ack, 1);
    assert!(session.poll_transmit().is_none(), "one ack per deadline");
}

#[test]
fn every_sixteenth_frame_acks_at_once() {
    let mut session = attached(no_standalone_acks(Config::default()));
    for seq in 0..15 {
        session.handle_frame(&data(1, seq, b"x"), T0).expect("data");
    }
    assert!(session.poll_transmit().is_none());
    session.handle_frame(&data(1, 15, b"x"), T0).expect("data");
    let ack = decode_frame(&poll_frame(&mut session));
    assert_eq!(ack.ack, 16);
}

#[test]
fn the_byte_budget_acks_at_once() {
    let mut session = attached(Config {
        ack_every_bytes: 4_096,
        ..no_standalone_acks(Config::default())
    });
    session
        .handle_frame(&data(1, 0, &[0u8; 4_095]), T0)
        .expect("data");
    assert!(session.poll_transmit().is_none());
    session
        .handle_frame(&data(1, 1, &[0u8; 1]), T0)
        .expect("data");
    let ack = decode_frame(&poll_frame(&mut session));
    assert_eq!(ack.ack, 2);
}

#[test]
fn duplicates_are_ignored_and_schedule_an_ack() {
    let mut session = attached(no_standalone_acks(Config::default()));
    session.handle_frame(&data(1, 0, b"x"), T0).expect("data");
    assert_eq!(messages(&mut session), vec![b"x".to_vec()]);
    assert!(session.poll_transmit().is_none());
    assert_eq!(session.poll_timeout(), Some(T0 + 10_000));

    session.handle_frame(&data(1, 0, b"x"), T0).expect("dup");
    session.handle_frame(&data(1, 0, b"x"), T0).expect("dup");
    assert_eq!(session.poll_event(), None);
    assert_eq!(session.poll_timeout(), Some(T0), "the ack is due at once");
    session.handle_timeout(T0);
    let ack = decode_frame(&poll_frame(&mut session));
    assert_eq!(ack.kind, Kind::Ack);
    assert_eq!(ack.ack, 1);
    assert!(session.poll_transmit().is_none(), "two duplicates, one ack");
}

#[test]
fn idle_queues_a_ping() {
    let mut session = attached(Config::default());
    assert_eq!(session.poll_timeout(), Some(T0 + 15_000));
    session.handle_timeout(T0 + 14_999);
    assert!(session.poll_transmit().is_none());
    session.handle_timeout(T0 + 15_000);
    assert_eq!(decode_frame(&poll_frame(&mut session)).kind, Kind::Ping);
    assert_eq!(session.poll_timeout(), Some(T0 + 30_000));
}

#[test]
fn a_ping_is_answered_with_a_pong() {
    let mut session = attached(Config::default());
    let ping = Frame::control(Kind::Ping, 0, &[]).encode();
    session.handle_frame(&ping, T0 + 5).expect("ping");
    assert_eq!(decode_frame(&poll_frame(&mut session)).kind, Kind::Pong);
    assert_eq!(session.poll_event(), None);
}

#[test]
fn silence_ends_in_one_dead_event_per_silence() {
    let mut session = attached(Config::default());
    let ping = Frame::control(Kind::Ping, 0, &[]).encode();
    session.handle_frame(&ping, T0 + 1_000).expect("ping");
    session.handle_timeout(T0 + 45_999);
    assert_eq!(session.poll_event(), None);
    session.handle_timeout(T0 + 46_000);
    assert_eq!(session.poll_event(), Some(Event::Dead));
    session.handle_timeout(T0 + 100_000);
    assert_eq!(session.poll_event(), None, "reported once");

    session.handle_frame(&ping, T0 + 100_001).expect("ping");
    session.handle_timeout(T0 + 145_001);
    assert_eq!(session.poll_event(), Some(Event::Dead));
}

#[test]
fn a_detached_session_has_no_deadlines() {
    let mut session = attached(Config::default());
    assert!(session.poll_timeout().is_some());
    session.detach();
    assert_eq!(session.poll_timeout(), None);
    session.handle_timeout(T0 + 500_000);
    assert_eq!(session.poll_event(), None);
}
