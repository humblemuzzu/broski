#![allow(dead_code)]

use std::collections::{HashMap, VecDeque};

use broski_link_core::crypto::{HandshakeMode, PublicBundle, StaticIdentity};
use broski_link_core::proto::Config;
use broski_link_core::{Error, Link, LinkEvent, CONFIG};

pub const T0: u64 = 1_000;
const MAX_TIMER_STEP_MS: u64 = 1_000;
const MAX_PUMP_STEPS: usize = 1_000_000;

pub type Delivered = Vec<(u32, Vec<u8>)>;

pub mod rand;

use self::rand::Rng;

pub struct Phone {
    pub identity: StaticIdentity,
    pub server: PublicBundle,
    pub link: Link,
    pub inbox: Vec<(u32, Vec<u8>)>,
    pub resumed: Vec<bool>,
    pub closed: Vec<u16>,
    pub dead: usize,
}

impl Phone {
    pub fn new(identity: StaticIdentity, server: PublicBundle) -> Self {
        Self {
            identity,
            server,
            link: Link::client(CONFIG),
            inbox: Vec::new(),
            resumed: Vec::new(),
            closed: Vec::new(),
            dead: 0,
        }
    }

    pub fn connect(&mut self, mode: HandshakeMode, _now_ms: u64) -> Result<Vec<u8>, Error> {
        self.link.connect(&self.identity, &self.server, mode)
    }

    pub fn handle(&mut self, wire: &[u8], now_ms: u64) -> Result<(), Error> {
        self.link.handle_wire(wire, now_ms)?;
        self.collect();
        Ok(())
    }

    pub fn send(&mut self, stream: u32, message: &[u8], now_ms: u64) -> Result<(), Error> {
        self.link.send(stream, message, now_ms)
    }

    pub fn disconnect(&mut self) {
        self.link.disconnect();
    }

    pub fn collect(&mut self) {
        while let Some(event) = self.link.poll_event() {
            match event {
                LinkEvent::Connected { resumed } => self.resumed.push(resumed),
                LinkEvent::Message { stream, bytes } => self.inbox.push((stream, bytes)),
                LinkEvent::PeerClosed(code) => self.closed.push(code),
                LinkEvent::Dead => self.dead += 1,
            }
        }
    }
}

pub struct Machine {
    pub identity: StaticIdentity,
    pub config: Config,
    pub allow: bool,
    pub pairing: Option<[u8; 32]>,
    pub inbox: Vec<(u32, Vec<u8>)>,
    pub resumed: Vec<bool>,
    pub closed: Vec<u16>,
    pub dead: usize,
    pub rejected: usize,
    sessions: HashMap<[u8; 16], Link>,
    live: Option<[u8; 16]>,
    rng: Rng,
}

impl Machine {
    pub fn new(seed: u64) -> Self {
        Self {
            identity: StaticIdentity::generate().expect("identity"),
            config: CONFIG,
            allow: true,
            pairing: None,
            inbox: Vec::new(),
            resumed: Vec::new(),
            closed: Vec::new(),
            dead: 0,
            rejected: 0,
            sessions: HashMap::new(),
            live: None,
            rng: Rng::new(seed),
        }
    }

    pub fn public(&self) -> PublicBundle {
        self.identity.public()
    }

    /// Returns `Ok(None)` when the peer is not allowed: the daemon drops the
    /// accepted handshake and never answers.
    pub fn accept_hello(&mut self, msg1: &[u8], now_ms: u64) -> Result<Option<Vec<u8>>, Error> {
        let pairing = self.pairing;
        let mut accepted = Link::accept(&self.identity, msg1, || pairing)?;
        if !self.allow {
            self.rejected += 1;
            return Ok(None);
        }
        if let Some(resume) = accepted.resume {
            if self.sessions.contains_key(&resume.session_id) {
                let link = self
                    .sessions
                    .get_mut(&resume.session_id)
                    .ok_or(Error::NoSession)?;
                match accepted.resume(link, now_ms) {
                    Ok(msg2) => {
                        self.live = Some(resume.session_id);
                        self.collect();
                        return Ok(Some(msg2));
                    }
                    Err(Error::Proto(broski_link_core::proto::Error::ResumeMismatch {
                        ..
                    })) => {
                        self.sessions.remove(&resume.session_id);
                    }
                    Err(other) => return Err(other),
                }
            }
        }
        let session_id = self.next_session_id();
        let (link, msg2) = accepted.fresh(self.config, session_id, now_ms)?;
        self.sessions.insert(session_id, link);
        self.live = Some(session_id);
        self.collect();
        Ok(Some(msg2))
    }

    pub fn session_id(&self) -> Option<[u8; 16]> {
        self.live_link().and_then(Link::session_id)
    }

    pub fn unacked_bytes(&self) -> usize {
        self.live_link().map_or(0, Link::unacked_bytes)
    }

    pub fn is_connected(&self) -> bool {
        self.live_link().is_some_and(Link::is_connected)
    }

    pub fn link_for(&mut self, session_id: [u8; 16]) -> Option<&mut Link> {
        self.sessions.get_mut(&session_id)
    }

    pub fn close(&mut self, code: u16) {
        if let Some(link) = self.live_link_mut() {
            link.close(code);
        }
    }

    pub fn poll_transmit(&mut self) -> Result<Option<Vec<u8>>, Error> {
        match self.live_link_mut() {
            Some(link) => link.poll_transmit(),
            None => Ok(None),
        }
    }

    pub fn poll_timeout(&self) -> Option<u64> {
        self.live_link().and_then(Link::poll_timeout)
    }

    pub fn handle_timeout(&mut self, now_ms: u64) {
        if let Some(link) = self.live_link_mut() {
            link.handle_timeout(now_ms);
        }
        self.collect();
    }

    pub fn deliver(&mut self, wire: &[u8], now_ms: u64) -> Result<(), Error> {
        self.live_link_mut()
            .ok_or(Error::NotConnected)?
            .handle_wire(wire, now_ms)?;
        self.collect();
        Ok(())
    }

    pub fn send(&mut self, stream: u32, message: &[u8], now_ms: u64) -> Result<(), Error> {
        self.live_link_mut()
            .ok_or(Error::NotConnected)?
            .send(stream, message, now_ms)
    }

    pub fn disconnect(&mut self) {
        if let Some(link) = self.live_link_mut() {
            link.disconnect();
        }
    }

    pub fn forget_sessions(&mut self) {
        self.disconnect();
        self.sessions.clear();
        self.live = None;
    }

    fn live_link(&self) -> Option<&Link> {
        self.live.and_then(|id| self.sessions.get(&id))
    }

    fn live_link_mut(&mut self) -> Option<&mut Link> {
        let live = self.live?;
        self.sessions.get_mut(&live)
    }

    fn collect(&mut self) {
        loop {
            let event = self.live_link_mut().and_then(Link::poll_event);
            let Some(event) = event else { break };
            match event {
                LinkEvent::Connected { resumed } => self.resumed.push(resumed),
                LinkEvent::Message { stream, bytes } => self.inbox.push((stream, bytes)),
                LinkEvent::PeerClosed(code) => self.closed.push(code),
                LinkEvent::Dead => self.dead += 1,
            }
        }
    }

    fn next_session_id(&mut self) -> [u8; 16] {
        let mut id = [0u8; 16];
        for chunk in id.chunks_mut(8) {
            chunk.copy_from_slice(&self.rng.next_u64().to_be_bytes());
        }
        id
    }
}

pub struct Harness {
    pub phone: Phone,
    pub machine: Machine,
    pub secret: [u8; 32],
    pub to_machine: VecDeque<Vec<u8>>,
    pub to_phone: VecDeque<Vec<u8>>,
    pub now: u64,
    pub rng: Rng,
}

impl Harness {
    pub fn new(seed: u64) -> Self {
        let mut machine = Machine::new(seed);
        let mut rng = Rng::new(seed);
        let mut secret = [0u8; 32];
        for byte in &mut secret {
            *byte = rng.below(256) as u8;
        }
        machine.pairing = Some(secret);
        Self {
            phone: Phone::new(
                StaticIdentity::generate().expect("identity"),
                machine.public(),
            ),
            machine,
            secret,
            to_machine: VecDeque::new(),
            to_phone: VecDeque::new(),
            now: T0,
            rng,
        }
    }

    pub fn pair(&mut self) -> Result<(), Error> {
        let secret = self.secret;
        let msg1 = self
            .phone
            .connect(HandshakeMode::Pair { secret }, self.now)?;
        self.answer(msg1)
    }

    pub fn reconnect(&mut self) -> Result<(), Error> {
        let msg1 = self.phone.connect(HandshakeMode::Connect, self.now)?;
        self.answer(msg1)
    }

    pub fn phone_send(&mut self, stream: u32, message: &[u8]) -> Result<(), Error> {
        self.phone.send(stream, message, self.now)
    }

    pub fn machine_send(&mut self, stream: u32, message: &[u8]) -> Result<(), Error> {
        self.machine.send(stream, message, self.now)
    }

    pub fn drop_route(&mut self) {
        self.to_machine.clear();
        self.to_phone.clear();
        self.phone.disconnect();
        self.machine.disconnect();
    }

    pub fn collect(&mut self) -> Result<(), Error> {
        while let Some(wire) = self.phone.link.poll_transmit()? {
            self.to_machine.push_back(wire);
        }
        while let Some(wire) = self.machine.poll_transmit()? {
            self.to_phone.push_back(wire);
        }
        Ok(())
    }

    pub fn step(&mut self) -> Result<(), Error> {
        if let Some(wire) = self.to_machine.pop_front() {
            self.machine.deliver(&wire, self.now)?;
        }
        if let Some(wire) = self.to_phone.pop_front() {
            self.phone.handle(&wire, self.now)?;
        }
        Ok(())
    }

    /// Moves every queued byte with no timers, so a perf loop measures the link.
    pub fn flush(&mut self) -> Result<(), Error> {
        let mut steps = 0;
        loop {
            self.collect()?;
            if self.to_machine.is_empty() && self.to_phone.is_empty() {
                return Ok(());
            }
            self.step()?;
            steps += 1;
            assert!(steps < MAX_PUMP_STEPS, "the wire never drained");
        }
    }

    pub fn pump(&mut self) -> Result<(), Error> {
        let mut steps = 0;
        loop {
            self.collect()?;
            if self.to_machine.is_empty() && self.to_phone.is_empty() {
                if !self.fire_timer() {
                    return Ok(());
                }
                continue;
            }
            self.step()?;
            steps += 1;
            assert!(steps < MAX_PUMP_STEPS, "the wire never drained");
        }
    }

    pub fn advance(&mut self, ms: u64) {
        self.now += ms;
        self.phone.link.handle_timeout(self.now);
        self.phone.collect();
        self.machine.handle_timeout(self.now);
    }

    fn answer(&mut self, msg1: Vec<u8>) -> Result<(), Error> {
        let msg2 = self
            .machine
            .accept_hello(&msg1, self.now)?
            .ok_or(Error::NotConnected)?;
        self.phone.handle(&msg2, self.now)
    }

    fn fire_timer(&mut self) -> bool {
        let deadline = [self.phone.link.poll_timeout(), self.machine.poll_timeout()]
            .into_iter()
            .flatten()
            .min();
        let Some(deadline) = deadline else {
            return false;
        };
        if deadline > self.now.saturating_add(MAX_TIMER_STEP_MS) {
            return false;
        }
        self.now = deadline.max(self.now);
        self.phone.link.handle_timeout(self.now);
        self.phone.collect();
        self.machine.handle_timeout(self.now);
        true
    }
}
