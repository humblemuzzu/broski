#![allow(dead_code)]

use broski_link_proto::{Config, Event, Frame, Kind, Session};

pub const T0: u64 = 1_000;

pub fn session(id: u8) -> Session {
    Session::new([id; 16], Config::default())
}

pub fn take(session: &mut Session) -> Vec<Vec<u8>> {
    let mut frames = Vec::new();
    while let Some(frame) = session.poll_transmit() {
        frames.push(frame);
    }
    frames
}

pub fn deliver(session: &mut Session, frames: &[Vec<u8>], now_ms: u64) {
    for frame in frames {
        session.handle_frame(frame, now_ms).expect("frame rejected");
    }
}

pub fn poll_frame(session: &mut Session) -> Vec<u8> {
    session.poll_transmit().expect("a queued frame")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decoded {
    pub kind: Kind,
    pub flags: u8,
    pub seq: u64,
    pub ack: u64,
    pub payload: Vec<u8>,
}

pub fn decode_frame(bytes: &[u8]) -> Decoded {
    let frame = Frame::decode(bytes, Config::default().max_frame).expect("decodable frame");
    Decoded {
        kind: frame.kind,
        flags: frame.flags,
        seq: frame.seq,
        ack: frame.ack,
        payload: frame.payload.to_vec(),
    }
}

pub fn events(session: &mut Session) -> Vec<Event> {
    let mut drained = Vec::new();
    while let Some(event) = session.poll_event() {
        drained.push(event);
    }
    drained
}

pub fn messages(session: &mut Session) -> Vec<Vec<u8>> {
    messages_with_stream(session)
        .into_iter()
        .map(|(_, bytes)| bytes)
        .collect()
}

pub fn messages_with_stream(session: &mut Session) -> Vec<(u32, Vec<u8>)> {
    events(session)
        .into_iter()
        .filter_map(|event| match event {
            Event::Message { stream, bytes } => Some((stream, bytes)),
            _ => None,
        })
        .collect()
}

pub struct Pipe {
    pub a: Session,
    pub b: Session,
    pub wire_bytes: usize,
}

impl Pipe {
    pub fn new(now_ms: u64) -> Self {
        Self::with(session(1), session(2), now_ms)
    }

    pub fn with(mut a: Session, mut b: Session, now_ms: u64) -> Self {
        let a_expected = a.next_expected();
        let b_expected = b.next_expected();
        a.attach(b_expected, now_ms).expect("attach");
        b.attach(a_expected, now_ms).expect("attach");
        Self {
            a,
            b,
            wire_bytes: 0,
        }
    }

    pub fn resume(&mut self, now_ms: u64) {
        let a_expected = self.a.next_expected();
        let b_expected = self.b.next_expected();
        self.a.detach();
        self.b.detach();
        self.a.attach(b_expected, now_ms).expect("attach");
        self.b.attach(a_expected, now_ms).expect("attach");
    }

    pub fn pump(&mut self, now_ms: u64) -> usize {
        let mut frames = 0;
        loop {
            let mut progress = 0;
            for endpoint in [&mut self.a, &mut self.b] {
                if endpoint.poll_timeout().is_some_and(|t| t <= now_ms) {
                    endpoint.handle_timeout(now_ms);
                    progress += 1;
                }
            }
            for frame in take(&mut self.a) {
                self.wire_bytes += frame.len();
                self.b.handle_frame(&frame, now_ms).expect("a -> b");
                progress += 1;
            }
            for frame in take(&mut self.b) {
                self.wire_bytes += frame.len();
                self.a.handle_frame(&frame, now_ms).expect("b -> a");
                progress += 1;
            }
            frames += progress;
            if progress == 0 {
                return frames;
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed ^ 0x9E37_79B9_7F4A_7C15)
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    pub fn below(&mut self, bound: u64) -> u64 {
        self.next_u64() % bound
    }
}

pub fn random_bytes(rng: &mut Rng, len: usize) -> Vec<u8> {
    (0..len).map(|_| rng.below(256) as u8).collect()
}

pub fn compressible(len: usize) -> Vec<u8> {
    (0..len).map(|index| (index % 7) as u8).collect()
}
