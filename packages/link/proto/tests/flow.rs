mod common;

use broski_link_proto::{Config, Error, Frame, Kind, Session};
use common::{decode_frame, poll_frame, random_bytes, session, take, Pipe, Rng, T0};

#[test]
fn acks_release_the_unacked_buffer_and_backpressure_then_lifts() {
    let sender = Session::new(
        [1; 16],
        Config {
            max_unacked_bytes: 300_000,
            ..Config::default()
        },
    );
    let mut pipe = Pipe::with(sender, session(2), T0);
    let mut queued = 0;
    loop {
        let message = random_bytes(&mut Rng::new(queued as u64), 40_000);
        match pipe.a.send(1, &message, T0) {
            Ok(()) => queued += 1,
            Err(error) => {
                assert!(matches!(error, Error::Backpressure { .. }), "{error}");
                break;
            }
        }
        assert!(queued < 10, "backpressure never fired");
    }
    assert_eq!(queued, 7, "300_000 / 40_022 bytes per frame");
    let pending = pipe.a.unacked_bytes();
    assert_eq!(pending, 7 * (40_000 + broski_link_proto::HEADER_LEN));

    pipe.pump(T0 + 25);
    assert_eq!(pipe.a.unacked_bytes(), 0, "acks release the buffer");
    pipe.a
        .send(1, b"fits again", T0 + 26)
        .expect("send recovers");
}

#[test]
fn backpressure_queues_nothing() {
    let mut session = Session::new(
        [1; 16],
        Config {
            max_unacked_bytes: 100,
            ..Config::default()
        },
    );
    session.attach(0, T0).expect("attach");
    assert!(matches!(
        session.send(1, &[0u8; 200], T0),
        Err(Error::Backpressure {
            pending: 0,
            limit: 100
        })
    ));
    assert_eq!(session.unacked_bytes(), 0);
    assert!(take(&mut session).is_empty());

    let mut nearly_full = Session::new(
        [1; 16],
        Config {
            max_unacked_bytes: 40,
            ..Config::default()
        },
    );
    nearly_full.attach(0, T0).expect("attach");
    nearly_full
        .send(1, b"fits", T0)
        .expect("the first message fits");
    assert!(matches!(
        nearly_full.send(1, b"fits", T0),
        Err(Error::Backpressure {
            pending: 26,
            limit: 40
        })
    ));
    assert_eq!(nearly_full.unacked_bytes(), 26);
}

#[test]
fn outgoing_data_piggybacks_the_ack_and_saves_the_standalone_one() {
    let mut session = Session::new(
        [2; 16],
        Config {
            ack_every_frames: 100,
            ack_every_bytes: usize::MAX,
            ack_delay_ms: 1_000,
            ..Config::default()
        },
    );
    session.attach(0, T0).expect("attach");
    let data = Frame {
        kind: Kind::Data,
        flags: 0,
        stream: 1,
        seq: 0,
        ack: 0,
        payload: b"hello",
    };
    session.handle_frame(&data.encode(), T0).expect("data");
    assert!(session.poll_transmit().is_none(), "nothing to ack yet");

    session.send(2, b"reply", T0).expect("send");
    let reply = decode_frame(&poll_frame(&mut session));
    assert_eq!(reply.kind, Kind::Data);
    assert_eq!(reply.ack, 1);
    session.handle_timeout(T0 + 1_000);
    assert!(
        session.poll_transmit().is_none(),
        "the piggybacked ack already released the delay"
    );
}

#[test]
fn an_ack_before_transmission_drops_queued_frames() {
    let mut session = Session::new([1; 16], Config::default());
    session.attach(0, T0).expect("attach");
    session
        .send(1, &random_bytes(&mut Rng::new(1), 200_000), T0)
        .expect("send");
    let ack = Frame::control(Kind::Ack, 2, &[]).encode();
    session.handle_frame(&ack, T0).expect("ack");
    assert_eq!(session.unacked_bytes(), 65_000 + 5_088);

    let frames = take(&mut session);
    assert_eq!(frames.len(), 2, "acked frames are never transmitted");
    let first = decode_frame(&frames[0]);
    assert_eq!(first.seq, 2);
    assert_eq!(first.payload.len(), 64_978);
}

#[test]
fn peer_acks_beyond_what_was_sent_are_clamped() {
    let mut session = Session::new([1; 16], Config::default());
    session.attach(0, T0).expect("attach");
    session.send(1, b"one", T0).expect("send");
    let ack = Frame::control(Kind::Ack, u64::MAX, &[]).encode();
    session.handle_frame(&ack, T0).expect("ack");
    assert_eq!(session.unacked_bytes(), 0);
    take(&mut session);
    let ack = Frame::control(Kind::Ack, u64::MAX, &[]).encode();
    session.handle_frame(&ack, T0).expect("ack again");
    assert_eq!(session.unacked_bytes(), 0);
}
