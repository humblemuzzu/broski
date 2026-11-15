//! Attaching the machine's session and terminal views on the bridge socket in use.

use std::sync::Arc;

use super::state::{Shared, State};
use crate::attach::{Next, RATE_LIMIT_PAUSE};
use crate::requests::Waiter;
use crate::view::ViewEnd;

impl Shared {
    pub(crate) fn after_stream(self: &Arc<Self>, state: &mut State, stream: u64, next: Next) {
        match next {
            Next::Nothing => {}
            Next::Attach if state.streams.merge(stream) => {}
            Next::Attach => self.attach_stream(state, stream),
            Next::AttachLater => self.later(move |shared, state| {
                shared.attach_stream(state, stream);
            }),
        }
    }

    pub(crate) fn after_terminal(self: &Arc<Self>, state: &mut State, terminal: u64, next: Next) {
        match next {
            Next::Nothing => {}
            Next::Attach => self.attach_terminal(state, terminal),
            Next::AttachLater => self.later(move |shared, state| {
                shared.attach_terminal(state, terminal);
            }),
        }
    }

    /// Attaches a detached stream when the bridge is ready; otherwise the next ready bridge does.
    pub(crate) fn attach_stream(&self, state: &mut State, stream: u64) {
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
            if let Some(view) = state.streams.get_mut(stream) {
                view.end(ViewEnd::Refused {
                    message: format!("the link would not send the attach: {failure:?}"),
                });
            }
        }
    }

    pub(crate) fn attach_terminal(&self, state: &mut State, terminal: u64) {
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
            if let Some(view) = state.terminals.get_mut(terminal) {
                view.fail(format!("the link would not send the attach: {failure:?}"));
            }
        }
    }

    /// `act` after the bridge's rate-limit pause, unless the machine has gone by then.
    fn later(self: &Arc<Self>, act: impl FnOnce(&Shared, &mut State) + Send + 'static) {
        let shared = Arc::downgrade(self);
        self.runtime().handle().spawn(async move {
            tokio::time::sleep(RATE_LIMIT_PAUSE).await;
            if let Some(shared) = shared.upgrade() {
                act(&shared, &mut shared.lock());
            }
        });
    }
}
