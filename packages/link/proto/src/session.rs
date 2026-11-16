use std::collections::VecDeque;

use crate::ack::AckPolicy;
use crate::codec;
use crate::config::Config;
use crate::cursor::Cursor;
use crate::error::Error;
use crate::event::Event;
use crate::frame::{self, Frame, Kind, CLOSE_PAYLOAD_LEN, FLAG_DEFLATE, FLAG_MORE, HEADER_LEN};
use crate::keepalive::{Action, Keepalive};
use crate::reassembly::Reassembly;

/// Control frames the session will queue behind its data. A peer that floods PING while the data
/// queue is backed up must not grow `out` without bound; anything past this many control frames is
/// dropped, except a CLOSE, which always gets in.
const MAX_QUEUED_CONTROL: usize = 32;

pub struct Session {
    session_id: [u8; 16],
    config: Config,
    now_ms: u64,
    attached: bool,
    /// Every DATA frame this session ever assigned: seqs run
    /// `base_seq` (oldest unacked) .. `next_seq` (next to assign).
    next_seq: u64,
    base_seq: u64,
    unacked: VecDeque<Vec<u8>>,
    unacked_bytes: usize,
    out: VecDeque<Out>,
    next_expected: u64,
    sent_ack: u64,
    events: VecDeque<Event>,
    reassembly: Reassembly,
    ack: AckPolicy,
    keepalive: Keepalive,
}

enum Out {
    Data(u64),
    Ctrl(Vec<u8>),
}

impl Session {
    pub fn new(session_id: [u8; 16], config: Config) -> Self {
        let ack = AckPolicy::new(&config);
        let keepalive = Keepalive::new(&config);
        let reassembly = Reassembly::new(config.max_message);
        Self {
            session_id,
            config,
            now_ms: 0,
            attached: false,
            next_seq: 0,
            base_seq: 0,
            unacked: VecDeque::new(),
            unacked_bytes: 0,
            out: VecDeque::new(),
            next_expected: 0,
            sent_ack: 0,
            events: VecDeque::new(),
            reassembly,
            ack,
            keepalive,
        }
    }

    pub fn session_id(&self) -> [u8; 16] {
        self.session_id
    }

    /// Next DATA seq this session expects, i.e. the value to advertise in
    /// `Hello`/`Welcome` and to hand to the peer's `attach`.
    pub fn next_expected(&self) -> u64 {
        self.next_expected
    }

    pub fn unacked_bytes(&self) -> usize {
        self.unacked_bytes
    }

    /// Splits `message` across one or more DATA frames and queues them. Fails
    /// with `Error::Backpressure` — queueing nothing — when the encoded frames
    /// would push the unacked buffer past `max_unacked_bytes`.
    pub fn send(&mut self, stream: u32, message: &[u8], now_ms: u64) -> Result<(), Error> {
        self.now_ms = now_ms;
        let limit = self.config.max_unacked_bytes;
        // Not even a header fits, so reject before compressing the whole message again.
        if self.unacked_bytes + HEADER_LEN > limit {
            return Err(Error::Backpressure {
                pending: self.unacked_bytes,
                limit,
            });
        }
        let capacity = self.payload_capacity()?;
        let compressed = codec::deflate_if_smaller(message, self.config.compress_threshold);
        let (payload, deflate) = match &compressed {
            Some(bytes) => (bytes.as_slice(), FLAG_DEFLATE),
            None => (message, 0),
        };
        let fragments = payload.len().div_ceil(capacity).max(1);
        let total = payload.len() + fragments * HEADER_LEN;
        if self.unacked_bytes + total > limit {
            return Err(Error::Backpressure {
                pending: self.unacked_bytes,
                limit,
            });
        }
        for index in 0..fragments {
            let start = index * capacity;
            let end = payload.len().min(start + capacity);
            let more = if index + 1 < fragments { FLAG_MORE } else { 0 };
            let frame = Frame {
                kind: Kind::Data,
                flags: deflate | more,
                stream,
                seq: self.next_seq,
                ack: self.next_expected,
                payload: &payload[start..end],
            };
            let encoded = frame.encode();
            self.unacked_bytes += encoded.len();
            self.unacked.push_back(encoded);
            self.out.push_back(Out::Data(self.next_seq));
            self.next_seq += 1;
        }
        Ok(())
    }

    /// Takes one encoded frame straight off a Noise message. `seq` gaps are a
    /// protocol error: a connection delivers frames in the order they were sent.
    pub fn handle_frame(&mut self, bytes: &[u8], now_ms: u64) -> Result<(), Error> {
        let frame = Frame::decode(bytes, self.config.max_frame)?;
        self.now_ms = now_ms;
        if self.attached {
            self.keepalive.on_recv(now_ms);
        }
        self.on_ack(frame.ack);
        match frame.kind {
            Kind::Data => self.on_data(&frame, now_ms),
            Kind::Ack | Kind::Pong => Ok(()),
            Kind::Ping => {
                self.queue_control(Kind::Pong, &[]);
                Ok(())
            }
            Kind::Close => {
                let code = Cursor::new(frame.payload).u16("CLOSE")?;
                self.events.push_back(Event::PeerClosed(code));
                Ok(())
            }
        }
    }

    /// Next encoded frame to seal and hand to Noise, in the order the session
    /// wants them sent. Every frame carries the current ack, patched in here.
    pub fn poll_transmit(&mut self) -> Option<Vec<u8>> {
        let out = self.out.pop_front()?;
        let ack = self.next_expected;
        let bytes = match out {
            Out::Data(seq) => {
                let frame = self.frame_at(seq)?;
                frame::patch_ack(frame, ack);
                frame.clone()
            }
            Out::Ctrl(mut bytes) => {
                frame::patch_ack(&mut bytes, ack);
                bytes
            }
        };
        if ack > self.sent_ack {
            self.sent_ack = ack;
            self.ack.reset();
        }
        self.keepalive.on_send(self.now_ms);
        Some(bytes)
    }

    pub fn poll_event(&mut self) -> Option<Event> {
        self.events.pop_front()
    }

    /// Earliest deadline the caller should call `handle_timeout` at.
    pub fn poll_timeout(&self) -> Option<u64> {
        self.ack
            .next_deadline()
            .into_iter()
            .chain(self.keepalive.next_deadline())
            .min()
    }

    pub fn handle_timeout(&mut self, now_ms: u64) {
        self.now_ms = now_ms;
        if self.ack.take_due(now_ms) {
            self.queue_control(Kind::Ack, &[]);
        }
        match self.keepalive.on_timeout(now_ms) {
            Some(Action::Ping) => self.queue_control(Kind::Ping, &[]),
            Some(Action::Dead) => self.events.push_back(Event::Dead),
            None => {}
        }
    }

    /// Pings the peer now and reports `Event::Dead` unless a frame arrives within `within_ms`: the
    /// connection may have died without a word, after the network under it changed. False while
    /// detached.
    pub fn probe(&mut self, now_ms: u64, within_ms: u64) -> bool {
        self.now_ms = now_ms;
        if !self.attached || !self.keepalive.probe(now_ms, within_ms) {
            return false;
        }
        self.queue_control(Kind::Ping, &[]);
        true
    }

    /// Binds the session to a fresh connection. `peer_next_expected` is the
    /// peer's receive frontier from its handshake payload: everything below it
    /// was received and is dropped, everything else is retransmitted. Outside
    /// `[base_seq, next_seq)` there is nothing to resume and the caller should
    /// start a new session instead.
    pub fn attach(&mut self, peer_next_expected: u64, now_ms: u64) -> Result<(), Error> {
        if peer_next_expected > self.next_seq || peer_next_expected < self.base_seq {
            return Err(Error::ResumeMismatch {
                peer: peer_next_expected,
                oldest: self.base_seq,
                sent: self.next_seq,
            });
        }
        let drop_count = peer_next_expected - self.base_seq;
        for _ in 0..drop_count {
            if let Some(frame) = self.unacked.pop_front() {
                self.unacked_bytes -= frame.len();
            }
        }
        self.base_seq = peer_next_expected;
        self.out.clear();
        for seq in self.base_seq..self.next_seq {
            self.out.push_back(Out::Data(seq));
        }
        self.ack.reset();
        self.sent_ack = self.next_expected;
        self.keepalive.start(now_ms);
        self.attached = true;
        self.now_ms = now_ms;
        Ok(())
    }

    /// The current connection is gone: unsent frames are dropped, the unacked
    /// buffer and the receive frontier survive for the next `attach`.
    pub fn detach(&mut self) {
        self.out.clear();
        self.ack.reset();
        self.keepalive.stop();
        self.attached = false;
    }

    pub fn close(&mut self, code: u16) {
        self.queue_control(Kind::Close, &code.to_be_bytes());
    }

    fn payload_capacity(&self) -> Result<usize, Error> {
        self.config
            .max_frame
            .checked_sub(HEADER_LEN)
            .filter(|capacity| *capacity >= CLOSE_PAYLOAD_LEN)
            .ok_or(Error::Config("max_frame leaves no room for a payload"))
    }

    fn on_data(&mut self, frame: &Frame<'_>, now_ms: u64) -> Result<(), Error> {
        if frame.seq < self.next_expected {
            self.ack.on_duplicate(now_ms);
            return Ok(());
        }
        if frame.seq > self.next_expected {
            return Err(Error::UnexpectedSeq {
                got: frame.seq,
                expected: self.next_expected,
            });
        }
        let complete = self
            .reassembly
            .push(frame.stream, frame.flags, frame.payload)?;
        self.next_expected += 1;
        if self.ack.on_data(frame.payload.len(), now_ms) {
            self.queue_control(Kind::Ack, &[]);
        }
        if let Some(bytes) = complete {
            self.events.push_back(Event::Message {
                stream: frame.stream,
                bytes,
            });
        }
        Ok(())
    }

    fn on_ack(&mut self, ack: u64) {
        let ack = ack.min(self.next_seq);
        let drop_count = ack
            .saturating_sub(self.base_seq)
            .min(self.unacked.len() as u64);
        for _ in 0..drop_count {
            if let Some(frame) = self.unacked.pop_front() {
                self.unacked_bytes -= frame.len();
            }
        }
        self.base_seq += drop_count;
        self.out
            .retain(|out| !matches!(out, Out::Data(seq) if *seq < ack));
    }

    fn frame_at(&mut self, seq: u64) -> Option<&mut Vec<u8>> {
        let index = usize::try_from(seq.checked_sub(self.base_seq)?).ok()?;
        self.unacked.get_mut(index)
    }

    fn queue_control(&mut self, kind: Kind, payload: &[u8]) {
        if kind != Kind::Close {
            let queued = self
                .out
                .iter()
                .filter(|out| matches!(out, Out::Ctrl(_)))
                .count();
            if queued >= MAX_QUEUED_CONTROL {
                return;
            }
        }
        let frame = Frame::control(kind, self.next_expected, payload);
        self.out.push_back(Out::Ctrl(frame.encode()));
    }
}
