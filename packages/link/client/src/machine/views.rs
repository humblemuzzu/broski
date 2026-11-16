//! Attaching the machine's session and terminal views on the bridge socket in use, and again after a
//! pause when an attach was refused for a reason that passes or was not sent.

use std::sync::Arc;

use tokio::time::Instant;

use super::state::{Shared, State};
use crate::attach::Next;
use crate::requests::Waiter;

impl Shared {
    pub(crate) fn after_stream(self: &Arc<Self>, state: &mut State, stream: u64, next: Next) {
        match next {
            Next::Nothing => {}
            Next::Attach if state.streams.merge(stream) => {}
            Next::Attach => self.attach_stream(state, stream),
            Next::AttachAfter(pause) => self.later(pause, move |shared, state| {
                shared.attach_stream(state, stream);
            }),
        }
    }

    pub(crate) fn after_terminal(self: &Arc<Self>, state: &mut State, terminal: u64, next: Next) {
        match next {
            Next::Nothing => {}
            Next::Attach => self.attach_terminal(state, terminal),
            Next::AttachAfter(pause) => self.later(pause, move |shared, state| {
                shared.attach_terminal(state, terminal);
            }),
        }
    }

    /// Attaches a detached stream when the bridge is ready; otherwise the next ready bridge does.
    pub(crate) fn attach_stream(self: &Arc<Self>, state: &mut State, stream: u64) {
        let ready = state.contract.ready() && state.ended.is_none();
        let Some(view) = state
            .streams
            .get_mut(stream)
            .filter(|view| view.needs_attach())
        else {
            return;
        };
        if !ready {
            return;
        }
        let request = view.attach_request();
        if let Err(failure) = self.send_ready(state, request, Some(Waiter::Attach(stream))) {
            let why = format!("the link would not send the attach: {failure:?}");
            self.stream_not_sent(state, stream, why);
        }
    }

    pub(crate) fn attach_terminal(self: &Arc<Self>, state: &mut State, terminal: u64) {
        let ready = state.contract.ready() && state.ended.is_none();
        let Some(view) = state
            .terminals
            .get_mut(terminal)
            .filter(|view| view.needs_attach())
        else {
            return;
        };
        if !ready {
            return;
        }
        let request = view.attach_request();
        if let Err(failure) = self.send_ready(state, request, Some(Waiter::TermAttach(terminal))) {
            let why = format!("the link would not send the attach: {failure:?}");
            self.terminal_not_sent(state, terminal, why);
        }
    }

    pub(crate) fn stream_not_sent(self: &Arc<Self>, state: &mut State, stream: u64, why: String) {
        if let Some(next) = state
            .streams
            .get_mut(stream)
            .map(|view| view.not_sent(why, Instant::now()))
        {
            self.after_stream(state, stream, next);
        }
    }

    pub(crate) fn terminal_not_sent(
        self: &Arc<Self>,
        state: &mut State,
        terminal: u64,
        why: String,
    ) {
        if let Some(next) = state
            .terminals
            .get_mut(terminal)
            .map(|view| view.not_sent(why, Instant::now()))
        {
            self.after_terminal(state, terminal, next);
        }
    }
}
