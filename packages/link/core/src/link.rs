use std::collections::VecDeque;

use crate::crypto::{
    HandshakeMode, HandshakeModeKind, Initiator, PublicBundle, Responder, StaticIdentity, Transport,
};
use crate::error::{Error, Result};
use crate::proto::{Config, Event, Hello, Resume, Session, Welcome};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkEvent {
    /// Handshake done. `resumed = false` means the peer started a new session:
    /// every message it had not acknowledged is gone, so the app must resync.
    Connected {
        resumed: bool,
    },
    Message {
        stream: u32,
        bytes: Vec<u8>,
    },
    PeerClosed(u16),
    /// Nothing arrived for `dead_after_ms`: drop the connection and reconnect.
    Dead,
}

pub struct Link {
    config: Config,
    session: Option<Session>,
    transport: Option<Transport>,
    initiator: Option<Initiator>,
    /// A handshake on a second connection while `transport` keeps carrying the session.
    migration: Option<Initiator>,
    events: VecDeque<LinkEvent>,
    closed: bool,
}

impl Link {
    pub fn client(config: Config) -> Self {
        Self {
            config,
            session: None,
            transport: None,
            initiator: None,
            migration: None,
            events: VecDeque::new(),
            closed: false,
        }
    }

    pub fn accept(
        identity: &StaticIdentity,
        msg1: &[u8],
        pairing_secret: impl FnOnce() -> Option<[u8; 32]>,
    ) -> Result<Accepted> {
        let (responder, peer, payload, mode) =
            Responder::read_first(identity, msg1, pairing_secret)?;
        let hello = Hello::decode(&payload)?;
        Ok(Accepted {
            responder: Some(responder),
            peer,
            mode,
            resume: hello.resume,
        })
    }

    /// Detaches the current connection and returns msg1. A Hello carrying
    /// `Resume` goes out whenever this link already holds a session.
    pub fn connect(
        &mut self,
        identity: &StaticIdentity,
        server: &PublicBundle,
        mode: HandshakeMode,
    ) -> Result<Vec<u8>> {
        self.disconnect();
        self.closed = false;
        let resume = self.session.as_ref().map(|session| Resume {
            session_id: session.session_id(),
            next_expected: session.next_expected(),
        });
        // `caps` is reserved: both sides send 0 until a capability is negotiated.
        let hello = Hello { resume, caps: 0 };
        let (initiator, msg1) = Initiator::start(identity, server, mode, &hello.encode())?;
        self.initiator = Some(initiator);
        Ok(msg1)
    }

    /// Client: starts a handshake on a second connection and returns its msg1, while the current
    /// connection keeps carrying the session until `complete_migration`. The peer accepts a
    /// resume from a new connection the way it accepts one after a drop, so a migration that
    /// fails costs the current connection nothing. Only a connected link migrates.
    pub fn migrate(&mut self, identity: &StaticIdentity, server: &PublicBundle) -> Result<Vec<u8>> {
        if self.closed {
            return Err(Error::Closed);
        }
        if self.transport.is_none() {
            return Err(Error::NotConnected);
        }
        let session = self.session.as_ref().ok_or(Error::NoSession)?;
        let hello = Hello {
            resume: Some(Resume {
                session_id: session.session_id(),
                next_expected: session.next_expected(),
            }),
            caps: 0,
        };
        let (initiator, msg1) =
            Initiator::start(identity, server, HandshakeMode::Connect, &hello.encode())?;
        self.migration = Some(initiator);
        Ok(msg1)
    }

    /// msg2 from the migration's connection: the session moves onto it, and `Connected` reports
    /// whether the peer resumed. Frames that crossed the old connection after msg1 are sorted out
    /// by the resume itself: the peer re-sends what this side had not received, and drops what it
    /// already had. An error ends the migration and leaves the current connection carrying the
    /// session.
    pub fn complete_migration(&mut self, msg2: &[u8], now_ms: u64) -> Result<()> {
        let initiator = self.migration.take().ok_or(Error::NoMigration)?;
        let (transport, payload) = initiator.finish(msg2)?;
        let welcome = Welcome::decode(&payload)?;
        self.finish_client_handshake(welcome, transport, now_ms)
    }

    /// The migration's connection failed; the current one is untouched.
    pub fn abandon_migration(&mut self) {
        self.migration = None;
    }

    pub fn is_migrating(&self) -> bool {
        self.migration.is_some()
    }

    /// Client: msg2 first, then sealed frames. Server: sealed frames only.
    pub fn handle_wire(&mut self, bytes: &[u8], now_ms: u64) -> Result<()> {
        if let Some(initiator) = self.initiator.take() {
            let (transport, payload) = initiator.finish(bytes)?;
            let welcome = Welcome::decode(&payload)?;
            return self.finish_client_handshake(welcome, transport, now_ms);
        }
        self.handle_sealed(bytes, now_ms)
    }

    /// Queued in the session while detached: it goes out after the next
    /// `attach`, or is dropped when the peer answers with a new session.
    pub fn send(&mut self, stream: u32, message: &[u8], now_ms: u64) -> Result<()> {
        if self.closed {
            return Err(Error::Closed);
        }
        self.session
            .as_mut()
            .ok_or(Error::NoSession)?
            .send(stream, message, now_ms)?;
        Ok(())
    }

    /// One sealed proto frame per call, `None` while detached.
    pub fn poll_transmit(&mut self) -> Result<Option<Vec<u8>>> {
        let Some(transport) = self.transport.as_mut() else {
            return Ok(None);
        };
        let Some(session) = self.session.as_mut() else {
            return Ok(None);
        };
        let Some(frame) = session.poll_transmit() else {
            return Ok(None);
        };
        let mut wire = Vec::with_capacity(frame.len() + 16);
        transport.seal(&frame, &mut wire)?;
        Ok(Some(wire))
    }

    pub fn poll_event(&mut self) -> Option<LinkEvent> {
        self.events.pop_front()
    }

    pub fn poll_timeout(&self) -> Option<u64> {
        self.session.as_ref().and_then(Session::poll_timeout)
    }

    pub fn handle_timeout(&mut self, now_ms: u64) {
        if let Some(session) = self.session.as_mut() {
            session.handle_timeout(now_ms);
        }
        self.drain_events();
    }

    /// The connection is gone; the session survives for the next resume.
    pub fn disconnect(&mut self) {
        self.transport = None;
        self.initiator = None;
        self.migration = None;
        if let Some(session) = self.session.as_mut() {
            session.detach();
        }
    }

    /// Tells the peer this session is over and refuses further sends.
    pub fn close(&mut self, code: u16) {
        if let Some(session) = self.session.as_mut() {
            session.close(code);
        }
        self.closed = true;
    }

    pub fn is_connected(&self) -> bool {
        self.transport.is_some()
    }

    pub fn session_id(&self) -> Option<[u8; 16]> {
        self.session.as_ref().map(Session::session_id)
    }

    pub fn unacked_bytes(&self) -> usize {
        self.session.as_ref().map_or(0, Session::unacked_bytes)
    }

    fn handle_sealed(&mut self, bytes: &[u8], now_ms: u64) -> Result<()> {
        if self.closed {
            return Err(Error::Closed);
        }
        let transport = self.transport.as_mut().ok_or(Error::NotConnected)?;
        let mut frame = Vec::new();
        transport.open(bytes, &mut frame)?;
        self.session
            .as_mut()
            .ok_or(Error::NotConnected)?
            .handle_frame(&frame, now_ms)?;
        self.drain_events();
        Ok(())
    }

    fn finish_client_handshake(
        &mut self,
        welcome: Welcome,
        transport: Transport,
        now_ms: u64,
    ) -> Result<()> {
        let resumed = welcome.resumed
            && self
                .session
                .as_ref()
                .is_some_and(|session| session.session_id() == welcome.session_id);
        if resumed {
            self.session
                .as_mut()
                .ok_or(Error::NotConnected)?
                .attach(welcome.next_expected, now_ms)?;
        } else {
            let mut session = Session::new(welcome.session_id, self.config);
            session.attach(welcome.next_expected, now_ms)?;
            self.session = Some(session);
        }
        self.transport = Some(transport);
        self.events.push_back(LinkEvent::Connected { resumed });
        Ok(())
    }

    fn drain_events(&mut self) {
        while let Some(event) = self.session.as_mut().and_then(Session::poll_event) {
            match event {
                Event::Message { stream, bytes } => {
                    self.events.push_back(LinkEvent::Message { stream, bytes });
                }
                Event::PeerClosed(code) => {
                    self.closed = true;
                    self.events.push_back(LinkEvent::PeerClosed(code));
                }
                Event::Dead => self.events.push_back(LinkEvent::Dead),
            }
        }
    }
}

/// A msg1 that the responder has read and authenticated but not yet answered.
/// The daemon checks the allowlist and its session table between `accept` and
/// `resume`/`fresh`.
pub struct Accepted {
    responder: Option<Responder>,
    pub peer: PublicBundle,
    pub mode: HandshakeModeKind,
    pub resume: Option<Resume>,
}

impl Accepted {
    /// Binds `link` — the server-side link holding this device's session — to the
    /// new connection and returns msg2. `Error::Proto(ResumeMismatch)` means the
    /// link cannot continue that stream; answer with [`Accepted::fresh`] instead.
    pub fn resume(&mut self, link: &mut Link, now_ms: u64) -> Result<Vec<u8>> {
        let resume = self.resume.ok_or(Error::NoResumeOffer)?;
        if link.session_id() != Some(resume.session_id) {
            return Err(Error::SessionMismatch);
        }
        let session = link.session.as_mut().ok_or(Error::NoSession)?;
        session.attach(resume.next_expected, now_ms)?;
        let welcome = Welcome {
            session_id: resume.session_id,
            resumed: true,
            next_expected: session.next_expected(),
            caps: 0,
        };
        Self::answer(self.responder.take(), &welcome, link, true)
    }

    /// Starts the session `session_id` (16 random bytes from the caller) and
    /// returns the new server link plus msg2.
    pub fn fresh(
        mut self,
        config: Config,
        session_id: [u8; 16],
        now_ms: u64,
    ) -> Result<(Link, Vec<u8>)> {
        let mut session = Session::new(session_id, config);
        session.attach(0, now_ms)?;
        let welcome = Welcome {
            session_id,
            resumed: false,
            next_expected: session.next_expected(),
            caps: 0,
        };
        let mut link = Link {
            config,
            session: Some(session),
            transport: None,
            initiator: None,
            migration: None,
            events: VecDeque::new(),
            closed: false,
        };
        let msg2 = Self::answer(self.responder.take(), &welcome, &mut link, false)?;
        Ok((link, msg2))
    }

    fn answer(
        responder: Option<Responder>,
        welcome: &Welcome,
        link: &mut Link,
        resumed: bool,
    ) -> Result<Vec<u8>> {
        let (transport, msg2) = responder
            .ok_or(Error::HandshakeConsumed)?
            .reply(&welcome.encode())?;
        link.transport = Some(transport);
        link.events.push_back(LinkEvent::Connected { resumed });
        Ok(msg2)
    }
}
