//! The one reader of a machine's link session: every event, in order, applied under the machine's
//! lock, so an answer, the events after it and the views they feed never see each other out of order.

use std::sync::Arc;

use broski_contract::{CatalogEvent, CatalogMessage, ServerMessage};
use broski_link_session::Event;
use tokio::sync::oneshot;
use tokio::time::Instant;

use super::state::{Shared, State};
use crate::error::ClientError;
use crate::requests::Waiter;
use crate::view::ViewEnd;
use crate::wire::{self, Incoming};

/// Frames larger than this are read off the link thread, so a multi-megabyte snapshot does not hold
/// up every machine's sockets while it decodes; order is kept, since the pump waits for it.
const OFFLOAD_BYTES: usize = 64 * 1024;

pub(crate) async fn run(shared: Arc<Shared>, mut stop: oneshot::Receiver<()>) {
    loop {
        let event = tokio::select! {
            biased;
            _ = &mut stop => break,
            event = shared.session().next_event() => event,
        };
        let Some(event) = event else {
            break;
        };
        shared.handle(event).await;
        let mut state = shared.lock();
        if state.feed_changed() {
            shared.hold_waiting(&mut state);
            drop(state);
            shared.poke_inbox();
        }
    }
    let mut state = shared.lock();
    shared.end(&mut state, ClientError::Closed);
    drop(state);
    shared.poke_inbox();
}

impl Shared {
    async fn handle(self: &Arc<Self>, event: Event) {
        match event {
            Event::Bridge(bytes) => {
                let message = if bytes.len() > OFFLOAD_BYTES {
                    tokio::task::spawn_blocking(move || wire::read(&bytes))
                        .await
                        .ok()
                        .flatten()
                } else {
                    wire::read(&bytes)
                };
                if let Some(message) = message {
                    self.on_message(&mut self.lock(), message);
                }
            }
            Event::Status(status) => self.on_status(&mut self.lock(), status),
            Event::BridgeStatus(bridge) => self.on_bridge(&mut self.lock(), bridge),
            Event::RecordChanged(record) => {
                let mut state = self.lock();
                state.record = record;
                state.events.record();
            }
            Event::SendFailed { tag, reason } => self.on_send_failed(&mut self.lock(), tag, reason),
        }
    }

    pub(super) fn on_message(self: &Arc<Self>, state: &mut State, message: ServerMessage) {
        match wire::classify(message) {
            Incoming::Answer(id, answer) => {
                if let Some(waiter) = state.requests.answered(&id) {
                    self.answer(state, waiter, answer);
                }
            }
            Incoming::Unattributed(error) => tracing::debug!(?error, "an error for no request"),
            Incoming::Pushed(pushed) => self.pushed(state, pushed),
        }
    }

    fn answer(self: &Arc<Self>, state: &mut State, waiter: Waiter, answer: ServerMessage) {
        match waiter {
            Waiter::Caller(sender) => {
                let _ = sender.send(Ok(answer));
            }
            Waiter::Hello => self.on_hello(state, answer),
            Waiter::Attach(stream) => {
                if let Some(next) = state
                    .streams
                    .get_mut(stream)
                    .map(|view| view.on_attach_answer(answer, Instant::now()))
                {
                    self.after_stream(state, stream, next);
                }
            }
            Waiter::TermAttach(terminal) => {
                if let Some(next) = state
                    .terminals
                    .get_mut(terminal)
                    .map(|view| view.on_attach_answer(answer, Instant::now()))
                {
                    self.after_terminal(state, terminal, next);
                }
            }
        }
    }

    fn pushed(self: &Arc<Self>, state: &mut State, message: ServerMessage) {
        match message {
            ServerMessage::Event(event) => {
                let envelope = event.envelope;
                if let Some((stream, view)) = state.streams.of_session(&envelope.session) {
                    let next = view.on_event(envelope);
                    self.after_stream(state, stream, next);
                }
            }
            ServerMessage::Catalog(catalog) => self.on_catalog(state, catalog),
            ServerMessage::TermOutput(output) => {
                if let Some((terminal, view)) = state.terminals.of_terminal(&output.id) {
                    let next = view.on_output(output);
                    self.after_terminal(state, terminal, next);
                }
            }
            ServerMessage::TermExited(exited) => {
                if let Some((_, view)) = state.terminals.of_terminal(&exited.id) {
                    view.on_exited(exited);
                }
            }
            other => tracing::debug!(?other, "an answer in the place of news"),
        }
    }

    fn on_catalog(self: &Arc<Self>, state: &mut State, message: CatalogMessage) {
        let backend = message.backend;
        match message.event {
            CatalogEvent::SessionUpdated(updated) => {
                state.catalog.lists.updated(&updated.summary);
                state.catalog.kept.updated(&updated.summary);
            }
            CatalogEvent::SessionRemoved(removed) => {
                state.catalog.lists.removed(&removed.session);
                state.catalog.kept.removed(&removed.session);
                state.streams.each(|stream| {
                    if stream.session() == &removed.session {
                        stream.end(ViewEnd::Removed);
                    }
                });
            }
            CatalogEvent::StatusChanged(changed) => {
                state.events.backend_status(&backend);
                let listed = state.catalog.set_status(backend, changed.status);
                if !listed {
                    self.relist_backends();
                }
            }
            CatalogEvent::CatalogInvalidated(invalidated) => {
                state.catalog.invalidate(&backend, invalidated.scope);
                state.events.invalidated(&backend, invalidated.scope);
            }
        }
    }
}
