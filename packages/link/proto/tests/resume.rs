mod common;

use broski_link_proto::{Config, Error, Frame, Hello, Kind, Resume, Session, Welcome};
use common::{compressible, deliver, messages_with_stream, random_bytes, take, Pipe, Rng, T0};

fn stream_of(index: usize) -> u32 {
    index as u32 % 3 + 1
}

#[test]
fn a_drop_between_frames_loses_nothing() {
    let mut pipe = Pipe::new(T0);
    let mut sent = Vec::new();
    for index in 0..20 {
        let message = random_bytes(&mut Rng::new(index as u64), 1_000 + index * 37);
        pipe.a.send(stream_of(index), &message, T0).expect("send");
        sent.push((stream_of(index), message));
    }
    let frames = take(&mut pipe.a);
    let delivered = frames.len() / 3;
    deliver(&mut pipe.b, &frames[..delivered], T0);
    assert_eq!(pipe.b.next_expected(), delivered as u64);

    pipe.resume(T0 + 5);
    pipe.pump(T0 + 5);
    assert_eq!(messages_with_stream(&mut pipe.b), sent);
}

#[test]
fn a_drop_before_anything_arrives_retransmits_everything() {
    let mut pipe = Pipe::new(T0);
    let mut sent = Vec::new();
    for index in 0..5 {
        let message = random_bytes(&mut Rng::new(100 + index as u64), 3_000 * (index + 1));
        pipe.a.send(stream_of(index), &message, T0).expect("send");
        sent.push((stream_of(index), message));
    }
    take(&mut pipe.a);
    pipe.resume(T0 + 1);
    assert_eq!(messages_with_stream(&mut pipe.b), Vec::new());
    pipe.pump(T0 + 1);
    assert_eq!(messages_with_stream(&mut pipe.b), sent);
}

#[test]
fn both_directions_survive_a_drop() {
    let mut pipe = Pipe::new(T0);
    let mut from_a = Vec::new();
    let mut from_b = Vec::new();
    for index in 0..10 {
        let to_b = random_bytes(&mut Rng::new(200 + index as u64), 2_000);
        let to_a = random_bytes(&mut Rng::new(300 + index as u64), 1_500);
        pipe.a.send(stream_of(index), &to_b, T0).expect("send");
        pipe.b.send(stream_of(index), &to_a, T0).expect("send");
        from_a.push((stream_of(index), to_b));
        from_b.push((stream_of(index), to_a));
    }
    let a_frames = take(&mut pipe.a);
    let b_frames = take(&mut pipe.b);
    deliver(&mut pipe.b, &a_frames[..a_frames.len() / 2], T0);
    deliver(&mut pipe.a, &b_frames[..b_frames.len() / 2], T0);

    pipe.resume(T0 + 7);
    pipe.pump(T0 + 7);
    assert_eq!(messages_with_stream(&mut pipe.b), from_a);
    assert_eq!(messages_with_stream(&mut pipe.a), from_b);
}

#[test]
fn fifty_drops_at_random_points_keep_the_stream_exact() {
    let mut pipe = Pipe::new(T0);
    let mut rng = Rng::new(0xB0B5_1234);
    let mut sent: Vec<(u32, Vec<u8>)> = Vec::new();
    let drop_at: Vec<usize> = {
        let mut picks: Vec<usize> = (0..50)
            .map(|block| block * 10 + rng.below(10) as usize)
            .collect();
        picks.sort_unstable();
        picks
    };
    let mut now = T0;
    let mut drops = 0;
    for index in 0..500 {
        let size = rng.below(150_000) as usize;
        let message = if rng.below(3) == 0 {
            compressible(size)
        } else {
            random_bytes(&mut rng, size)
        };
        let stream = rng.below(3) as u32 + 1;
        pipe.a.send(stream, &message, now).expect("send");
        sent.push((stream, message));
        now += 1;
        if drop_at.contains(&index) {
            let frames = take(&mut pipe.a);
            let keep = rng.below(frames.len() as u64 + 1) as usize;
            deliver(&mut pipe.b, &frames[..keep], now);
            pipe.resume(now);
            drops += 1;
        } else {
            pipe.pump(now);
        }
    }
    pipe.pump(now + 25);
    assert_eq!(drops, 50);
    assert_eq!(messages_with_stream(&mut pipe.b), sent);
}

#[test]
fn a_stale_resume_frontier_duplicates_on_the_wire_but_delivers_once() {
    let mut pipe = Pipe::new(T0);
    let mut sent = Vec::new();
    for index in 0..6 {
        let message = random_bytes(&mut Rng::new(500 + index as u64), 2_000);
        pipe.a.send(stream_of(index), &message, T0).expect("send");
        sent.push((stream_of(index), message));
    }
    let frames = take(&mut pipe.a);
    deliver(&mut pipe.b, &frames, T0);
    assert_eq!(pipe.b.next_expected(), frames.len() as u64);

    let stale = pipe.b.next_expected() - 2;
    pipe.a.detach();
    pipe.b.detach();
    pipe.a.attach(stale, T0 + 1).expect("attach");
    pipe.b.attach(0, T0 + 1).expect("attach");
    pipe.pump(T0 + 1);

    assert_eq!(
        messages_with_stream(&mut pipe.b),
        sent,
        "delivered exactly once"
    );
    assert_eq!(pipe.a.unacked_bytes(), 0, "the duplicate ack released it");
}

#[test]
fn the_handshake_payloads_carry_the_resume_window() {
    let mut phone = Session::new([7; 16], Config::default());
    phone.attach(0, T0).expect("attach");
    phone.send(1, b"one message", T0).expect("send");

    let mut machine = Session::new([7; 16], Config::default());
    machine.attach(0, T0).expect("attach");
    deliver(&mut machine, &take(&mut phone), T0);
    assert_eq!(machine.next_expected(), 1, "the machine got the message");
    assert_eq!(phone.unacked_bytes(), 33, "the ack was lost with the link");

    let hello = Hello {
        resume: Some(Resume {
            session_id: phone.session_id(),
            next_expected: phone.next_expected(),
        }),
        caps: 3,
    };
    let parsed = Hello::decode(&hello.encode()).expect("decode");
    let offer = parsed.resume.expect("resume offer");
    assert_eq!(offer.session_id, machine.session_id());
    assert_eq!(offer.next_expected, 0);

    let welcome = Welcome {
        session_id: machine.session_id(),
        resumed: offer.session_id == machine.session_id(),
        next_expected: machine.next_expected(),
        caps: parsed.caps,
    };
    let parsed = Welcome::decode(&welcome.encode()).expect("decode");
    assert!(parsed.resumed);
    assert_eq!(parsed.next_expected, 1);

    phone.detach();
    phone.attach(parsed.next_expected, T0 + 1).expect("attach");
    assert_eq!(phone.unacked_bytes(), 0, "the machine already had it");
    assert!(take(&mut phone).is_empty(), "nothing to retransmit");
    assert_eq!(
        messages_with_stream(&mut machine),
        vec![(1, b"one message".to_vec())]
    );
}

#[test]
fn resume_mismatch_reports_the_local_window() {
    let mut session = Session::new([1; 16], Config::default());
    session.attach(0, T0).expect("attach");
    session.send(1, b"one frame", T0).expect("send");
    assert_eq!(
        session.attach(2, T0),
        Err(Error::ResumeMismatch {
            peer: 2,
            oldest: 0,
            sent: 1
        })
    );
    take(&mut session);
    let ack = Frame::control(Kind::Ack, 1, &[]).encode();
    session.handle_frame(&ack, T0).expect("ack");
    assert_eq!(session.unacked_bytes(), 0);
    assert!(matches!(
        session.attach(0, T0),
        Err(Error::ResumeMismatch {
            peer: 0,
            oldest: 1,
            sent: 1
        })
    ));
}
