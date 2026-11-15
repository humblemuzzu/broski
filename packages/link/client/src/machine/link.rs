//! The bridge socket this phone talks through, and agreeing on the protocol with each new one.
//!
//! The daemon keeps one bridge socket per link session and counts them (`conn`, link-session.md):
//! a link session that resumes keeps its socket and everything this phone set up on it, a new link
//! session or a new `conn` is a socket that knows nothing of this phone. On one, the client says
//! `hello`, then attaches its views again, then sends what it held meanwhile. A hello the socket
//! refuses for any reason but the version is said again, after a pause that grows with each refusal.

use std::sync::Arc;
use std::time::Duration;

use broski_contract::{
    ClientMessage, HelloRequest, ProtocolErrorCode, ServerMessage, PROTOCOL_VERSION,
};
use broski_link_session::{BridgeState, BridgeStatus, LinkState, SendFailure, Status};

use super::state::{Contract, Shared, State};
use super::unexpected;
use crate::attach::RATE_LIMIT_PAUSE;
use crate::error::ClientError;
use crate::requests::Waiter;
use crate::view::ViewEnd;

/// The pause before the first hello again on a socket that refused one; it doubles with each
/// refusal on the same socket, up to `HELLO_RETRY_MAX`.
const HELLO_RETRY_FIRST: Duration = Duration::from_secs(1);
const HELLO_RETRY_MAX: Duration = Duration::from_secs(30);

fn hello_pause(refused: u32) -> Duration {
    HELLO_RETRY_FIRST
        .saturating_mul(2u32.saturating_pow(refused))
        .min(HELLO_RETRY_MAX)
}

impl Shared {
    pub(crate) fn on_status(&self, state: &mut State, status: Status) {
        let new_session = matches!(
            status.state,
            LinkState::Connected { resumed: false, .. }
                | LinkState::Connected {
                    session_reset: true,
                    ..
                }
        );
        let end = match status.state {
            LinkState::Revoked => Some(ClientError::Revoked),
            LinkState::Closed => Some(ClientError::Closed),
            _ => None,
        };
        state.link = status;
        state.events.status();
        if new_session {
            self.socket_lost(state);
        }
        if let Some(error) = end {
            self.end(state, error);
        }
    }

    pub(crate) fn on_bridge(self: &Arc<Self>, state: &mut State, bridge: BridgeStatus) {
        let up = bridge.state == BridgeState::Up;
        let current = state.contract.conn();
        let conn = bridge.conn;
        state.bridge = Some(bridge);
        state.events.status();
        if up && current == Some(conn) {
            return;
        }
        if current.is_some() {
            self.socket_lost(state);
        }
        if up && state.ended.is_none() {
            self.hello(state, conn, 0);
        }
    }

    fn hello(self: &Arc<Self>, state: &mut State, conn: u64, refused: u32) {
        let hello = ClientMessage::Hello(HelloRequest {
            request_id: String::new(),
            protocol: PROTOCOL_VERSION,
            client: self.client().clone(),
        });
        match self.send_unchecked(state, hello, Some(Waiter::Hello)) {
            Ok(()) => state.contract = Contract::Hello { conn, refused },
            Err(failure) => {
                let message = format!("the link would not send the hello: {failure:?}");
                self.hello_refused(state, conn, refused, message, Duration::ZERO);
            }
        }
    }

    /// The socket `conn` did not take a hello: it is said again after a pause, unless the socket
    /// has gone or the machine ended by then.
    fn hello_refused(
        self: &Arc<Self>,
        state: &mut State,
        conn: u64,
        refused: u32,
        message: String,
        at_least: Duration,
    ) {
        state.contract = Contract::Refused {
            conn,
            refused,
            message,
        };
        state.events.status();
        let pause = hello_pause(refused).max(at_least);
        self.later(pause, move |shared, state| {
            let current = matches!(
                state.contract,
                Contract::Refused { conn: now, refused: count, .. } if now == conn && count == refused
            );
            if current && state.ended.is_none() {
                shared.hello(state, conn, refused + 1);
                state.events.status();
            }
        });
    }

    pub(crate) fn on_hello(self: &Arc<Self>, state: &mut State, answer: ServerMessage) {
        let Contract::Hello { conn, refused } = state.contract else {
            return;
        };
        match answer {
            ServerMessage::HelloResult(hello) if hello.protocol.major == PROTOCOL_VERSION.major => {
                state.contract = Contract::Ready {
                    conn,
                    bridge_version: hello.bridge_version,
                };
                self.ready(state);
            }
            ServerMessage::HelloResult(hello) => {
                let message = format!(
                    "the bridge speaks protocol {}.{}; this phone speaks {}.{}",
                    hello.protocol.major,
                    hello.protocol.minor,
                    PROTOCOL_VERSION.major,
                    PROTOCOL_VERSION.minor
                );
                self.incompatible(state, conn, message);
            }
            ServerMessage::Error(error)
                if error.error.code == ProtocolErrorCode::UnsupportedVersion =>
            {
                self.incompatible(state, conn, error.error.message);
            }
            ServerMessage::Error(error) => {
                let at_least = match error.error.code {
                    ProtocolErrorCode::RateLimited => RATE_LIMIT_PAUSE,
                    _ => Duration::ZERO,
                };
                self.hello_refused(state, conn, refused, error.error.message, at_least);
            }
            other => {
                let message = unexpected(&other).to_string();
                self.hello_refused(state, conn, refused, message, Duration::ZERO);
            }
        }
        state.events.status();
    }

    fn incompatible(&self, state: &mut State, conn: u64, message: String) {
        for waiter in state.requests.drain_held() {
            let error = ClientError::Incompatible {
                detail: message.clone(),
            };
            self.fail(state, waiter, error);
        }
        state.contract = Contract::Incompatible { conn, message };
    }

    /// Views attach again first, so a held request that acts on a viewed session finds it viewed
    /// (the bridge serves a client's requests in the order they arrive, core README §6).
    fn ready(self: &Arc<Self>, state: &mut State) {
        for stream in state.streams.ids() {
            self.attach_stream(state, stream);
        }
        for terminal in state.terminals.keys() {
            self.attach_terminal(state, terminal);
        }
        for (id, frame) in state.requests.release_held() {
            if let Err(failure) = self.send(id, frame) {
                if let Some(waiter) = state.requests.remove(id) {
                    self.fail(state, waiter, ClientError::NotSent { failure });
                }
            }
        }
        state.catalog.forget();
        self.refresh_catalog();
    }

    /// The bridge socket in use is gone, with every answer still owed on it and every attachment.
    fn socket_lost(&self, state: &mut State) {
        state.contract = Contract::Waiting;
        for waiter in state.requests.drain_sent() {
            self.fail(state, waiter, ClientError::LinkReset);
        }
        state.streams.each(|stream| stream.detached());
        state.terminals.each(|terminal| terminal.detached());
    }

    pub(crate) fn on_send_failed(
        self: &Arc<Self>,
        state: &mut State,
        tag: Option<String>,
        reason: SendFailure,
    ) {
        let Some(waiter) = tag
            .and_then(|id| id.parse().ok())
            .and_then(|id| state.requests.remove(id))
        else {
            return;
        };
        let error = match reason {
            SendFailure::SessionReset => ClientError::LinkReset,
            SendFailure::Closed => ClientError::Closed,
            failure => ClientError::NotSent { failure },
        };
        let hello = match state.contract {
            Contract::Hello { conn, refused } => Some((conn, refused)),
            _ => None,
        };
        match (waiter, hello) {
            (Waiter::Hello, Some((conn, refused)))
                if matches!(error, ClientError::NotSent { .. }) =>
            {
                self.hello_refused(state, conn, refused, error.to_string(), Duration::ZERO);
            }
            (waiter, _) => self.fail(state, waiter, error),
        }
    }

    pub(crate) fn fail(&self, state: &mut State, waiter: Waiter, error: ClientError) {
        match waiter {
            Waiter::Caller(sender) => {
                let _ = sender.send(Err(error));
            }
            Waiter::Hello => state.contract = Contract::Waiting,
            Waiter::Attach(stream) => {
                if let Some(stream) = state.streams.get_mut(stream) {
                    stream.detached();
                }
            }
            Waiter::TermAttach(terminal) => {
                if let Some(terminal) = state.terminals.get_mut(terminal) {
                    terminal.detached();
                }
            }
        }
    }

    /// The machine is closed or revoked: every waiter is told, every view ends, nothing is sent.
    pub(crate) fn end(&self, state: &mut State, error: ClientError) {
        if state.ended.is_some() {
            return;
        }
        state.ended = Some(error.clone());
        for waiter in state.requests.drain() {
            self.fail(state, waiter, error.clone());
        }
        let reason = match error {
            ClientError::Revoked => ViewEnd::Revoked,
            _ => ViewEnd::Closed,
        };
        state.streams.each(|stream| stream.end(reason.clone()));
        state
            .terminals
            .each(|terminal| terminal.fail(error.to_string()));
        state.catalog.lists.wake_all();
        state.events.close();
    }
}
