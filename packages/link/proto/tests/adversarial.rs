mod common;

use broski_link_proto::{
    Config, Error, Event, Frame, Hello, Kind, Resume, Session, Welcome, FLAG_DEFLATE, FLAG_MORE,
    HEADER_LEN,
};
use common::{decode_frame, deliver, messages, poll_frame, take, T0};

fn header() -> Vec<u8> {
    Frame::control(Kind::Ping, 0, &[]).encode()
}

fn data(stream: u32, seq: u64, flags: u8, payload: &[u8]) -> Vec<u8> {
    Frame {
        kind: Kind::Data,
        flags,
        stream,
        seq,
        ack: 0,
        payload,
    }
    .encode()
}

#[test]
fn frame_decode_rejects_malformed_input() {
    let max = Config::default().max_frame;
    assert_eq!(
        Frame::decode(&[0u8; HEADER_LEN - 1], max),
        Err(Error::Truncated {
            what: "frame header"
        })
    );
    assert_eq!(
        Frame::decode(&[], max),
        Err(Error::Truncated {
            what: "frame header"
        })
    );

    let mut unknown = header();
    unknown[0] = 9;
    assert_eq!(Frame::decode(&unknown, max), Err(Error::UnknownKind(9)));

    let mut flags = header();
    flags[1] = 0x04;
    assert_eq!(Frame::decode(&flags, max), Err(Error::ReservedFlags(4)));

    assert_eq!(
        Frame::decode(&[0u8; 64], 32),
        Err(Error::FrameTooLarge { len: 64, max: 32 })
    );

    let mut close = header();
    close[0] = Kind::Close.as_u8();
    close.push(0);
    assert_eq!(Frame::decode(&close, max), Err(Error::ClosePayload(1)));
    close.push(1);
    assert_eq!(
        Frame::decode(&close, max).expect("two-byte code").payload,
        [0u8, 1].as_slice()
    );
}

#[test]
fn frame_round_trips_through_encode_and_decode() {
    let frame = Frame {
        kind: Kind::Data,
        flags: FLAG_DEFLATE,
        stream: 7,
        seq: 9,
        ack: 11,
        payload: b"payload",
    };
    let bytes = frame.encode();
    assert_eq!(bytes.len(), HEADER_LEN + frame.payload.len());
    assert_eq!(Frame::decode(&bytes, 65_000).expect("decode"), frame);
}

#[test]
fn hello_round_trips_and_decodes_strictly() {
    let hello = Hello {
        resume: Some(Resume {
            session_id: [3; 16],
            next_expected: 42,
        }),
        caps: 7,
    };
    let bytes = hello.encode();
    assert_eq!(bytes.len(), 30);
    assert_eq!(Hello::decode(&bytes).expect("decode"), hello);
    assert_eq!(
        Hello::decode(&bytes[..bytes.len() - 1]),
        Err(Error::Truncated { what: "Hello" })
    );
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert_eq!(
        Hello::decode(&trailing),
        Err(Error::TrailingBytes {
            what: "Hello",
            len: 1
        })
    );
    let mut version = bytes.clone();
    version[0] = 2;
    assert_eq!(Hello::decode(&version), Err(Error::UnknownVersion(2)));
    let mut flags = bytes.clone();
    flags[1] = 0x80;
    assert_eq!(Hello::decode(&flags), Err(Error::ReservedFlags(0x80)));

    let plain = Hello {
        resume: None,
        caps: 1,
    };
    assert_eq!(plain.encode().len(), 6);
    assert_eq!(Hello::decode(&plain.encode()).expect("decode"), plain);
}

#[test]
fn welcome_round_trips_and_decodes_strictly() {
    let welcome = Welcome {
        session_id: [9; 16],
        resumed: true,
        next_expected: 5,
        caps: 3,
    };
    let bytes = welcome.encode();
    assert_eq!(bytes.len(), 30);
    assert_eq!(Welcome::decode(&bytes).expect("decode"), welcome);
    assert_eq!(
        Welcome::decode(&bytes[..HEADER_LEN]),
        Err(Error::Truncated { what: "Welcome" })
    );
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert_eq!(
        Welcome::decode(&trailing),
        Err(Error::TrailingBytes {
            what: "Welcome",
            len: 1
        })
    );
    let mut version = bytes.clone();
    version[0] = 0;
    assert_eq!(Welcome::decode(&version), Err(Error::UnknownVersion(0)));

    let fresh = Welcome {
        session_id: [9; 16],
        resumed: false,
        next_expected: 0,
        caps: 0,
    };
    assert_eq!(Welcome::decode(&fresh.encode()).expect("decode"), fresh);
}

#[test]
fn session_rejects_gaps_interleaving_and_oversized_frames() {
    let mut session = Session::new([1; 16], Config::default());
    session.attach(0, T0).expect("attach");
    assert_eq!(
        session.handle_frame(&data(1, 5, 0, b"x"), T0),
        Err(Error::UnexpectedSeq {
            got: 5,
            expected: 0
        })
    );
    assert_eq!(
        session.handle_frame(&[0u8; 3], T0),
        Err(Error::Truncated {
            what: "frame header"
        })
    );

    let mut tiny = Session::new([1; 16], Config::new(64));
    tiny.attach(0, T0).expect("attach");
    assert_eq!(
        tiny.handle_frame(&[0u8; 100], T0),
        Err(Error::FrameTooLarge { len: 100, max: 64 })
    );

    session
        .handle_frame(&data(1, 0, FLAG_MORE, b"half"), T0)
        .expect("first fragment");
    assert_eq!(
        session.handle_frame(&data(2, 1, 0, b"half"), T0),
        Err(Error::InterleavedStream {
            expected: 1,
            got: 2
        })
    );
}

#[test]
fn send_rejects_a_max_frame_without_payload_room() {
    let mut session = Session::new([1; 16], Config::new(HEADER_LEN));
    assert_eq!(
        session.send(1, b"x", T0),
        Err(Error::Config("max_frame leaves no room for a payload"))
    );
}

#[test]
fn reassembly_stops_at_max_message() {
    let mut session = Session::new(
        [1; 16],
        Config {
            max_message: 1_000,
            ..Config::default()
        },
    );
    session.attach(0, T0).expect("attach");
    session
        .handle_frame(&data(1, 0, FLAG_MORE, &[7u8; 1_000]), T0)
        .expect("first fragment");
    assert_eq!(
        session.handle_frame(&data(1, 1, FLAG_MORE, &[7u8; 1_000]), T0),
        Err(Error::MessageTooLarge {
            len: 2_000,
            max: 1_000
        })
    );
}

#[test]
fn a_decompression_bomb_hits_the_message_limit() {
    let mut sender = Session::new(
        [1; 16],
        Config {
            compress_threshold: 1,
            ..Config::default()
        },
    );
    sender.attach(0, T0).expect("attach");
    let mut receiver = Session::new(
        [2; 16],
        Config {
            max_message: 1024 * 1024,
            ..Config::default()
        },
    );
    receiver.attach(0, T0).expect("attach");

    let zeros = vec![0u8; 100 * 1024 * 1024];
    sender.send(1, &zeros, T0).expect("send");
    let frames = take(&mut sender);
    let wire: usize = frames.iter().map(Vec::len).sum();
    assert!(wire < 1024 * 1024, "the bomb must fit the reassembly limit");
    assert!(wire > 1, "deflate of zeros is tiny but not empty");

    deliver(&mut receiver, &frames[..frames.len() - 1], T0);
    assert!(messages(&mut receiver).is_empty());
    assert_eq!(
        receiver.handle_frame(frames.last().expect("last frame"), T0),
        Err(Error::InflateTooLarge { max: 1024 * 1024 })
    );
}

#[test]
fn a_malformed_deflate_stream_is_an_error_not_a_panic() {
    let mut session = Session::new([1; 16], Config::default());
    session.attach(0, T0).expect("attach");
    let frame = Frame {
        kind: Kind::Data,
        flags: FLAG_DEFLATE,
        stream: 1,
        seq: 0,
        ack: 0,
        payload: b"not a deflate stream",
    };
    assert_eq!(
        session.handle_frame(&frame.encode(), T0),
        Err(Error::Inflate)
    );
}

#[test]
fn close_carries_a_two_byte_reason() {
    let mut session = Session::new([1; 16], Config::default());
    session.attach(0, T0).expect("attach");
    session.close(7);
    let close = poll_frame(&mut session);
    let frame = decode_frame(&close);
    assert_eq!(frame.kind, Kind::Close);
    assert_eq!(frame.payload, 7u16.to_be_bytes().as_slice());

    let mut peer = Session::new([2; 16], Config::default());
    peer.attach(0, T0).expect("attach");
    peer.handle_frame(&close, T0).expect("close");
    assert_eq!(peer.poll_event(), Some(Event::PeerClosed(7)));
}
