//! Streams the inbox keeps viewed with no screen reading them, so a row waiting on the person knows
//! its pending interaction and its options.

use broski_contract::{ClientMessage, SessionRef};

use super::{Phase, Streams};
use crate::error::ClientError;

impl Streams {
    /// Keeps `session` viewed for the inbox: the stream viewing it, or a new one the caller then
    /// attaches (returned). A held stream that ended (the bridge refused its attach) stays as it
    /// is, so a session the bridge will not attach is not asked again on every event. Fails at the
    /// bound on viewed sessions.
    pub(crate) fn hold(&mut self, session: &SessionRef) -> Result<Option<u64>, ClientError> {
        let ended = |state: &super::StreamState| state.held && state.phase == Phase::Ended;
        if self
            .streams
            .values()
            .any(|state| ended(state) && &state.session == session)
        {
            return Ok(None);
        }
        let (stream, new) = match self.viewing(session) {
            Some(stream) => (stream, false),
            None => (self.open(session)?, true),
        };
        if let Some(state) = self.streams.get_mut(&stream) {
            state.held = true;
        }
        Ok(new.then_some(stream))
    }

    /// The inbox lets the stream go; it goes, with the detach to send, unless a screen reads it.
    pub(crate) fn release(&mut self, stream: u64) -> Option<ClientMessage> {
        let state = self.streams.get_mut(&stream)?;
        state.held = false;
        if !state.subscribers.is_empty() {
            return None;
        }
        self.remove(stream)
    }

    /// Every stream the inbox holds, with its session.
    pub(crate) fn held(&self) -> Vec<(u64, SessionRef)> {
        self.streams
            .iter()
            .filter(|(_, state)| state.held)
            .map(|(id, state)| (*id, state.session.clone()))
            .collect()
    }
}
