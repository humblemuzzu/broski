//! One paired machine: its link session, the contract client over it, and the views, lists and
//! terminals the app opens on it.

mod events;
mod holds;
#[cfg(test)]
mod holds_tests;
mod link;
mod pump;
pub(crate) mod state;
#[cfg(test)]
mod tests;
mod views;

use std::sync::{Arc, Mutex, PoisonError};

use broski_contract::{
    ClientInfo, ClientMessage, ServerMessage, SessionRef, SessionSummary, TerminalId,
};
use broski_link_session::{LinkRuntime, MachineRecord, PushPlatform, Session};
use tokio::sync::{oneshot, Notify};

use self::events::Taken;
pub use self::events::{ContractState, MachineEvent, MachineStatus};
pub(crate) use self::state::Shared;
use crate::error::ClientError;
use crate::terminal::TerminalView;
use crate::view::stream::LiveInfo;
use crate::view::SessionView;
use crate::wait;

/// A session the inbox shows, with what a view of it knows live.
pub(crate) struct InboxSource {
    pub(crate) row: SessionSummary,
    pub(crate) live: Option<LiveInfo>,
}

/// A paired machine. Dropping the last handle (views and lists hold one) stops it quietly: the
/// machine keeps the link session for a later start. `close` ends it on the machine too.
pub struct Machine {
    shared: Arc<Shared>,
    stop: Mutex<Option<oneshot::Sender<()>>>,
}

impl Machine {
    pub(crate) fn spawn(
        runtime: &LinkRuntime,
        session: Session,
        record: MachineRecord,
        client: ClientInfo,
        inbox: Arc<Notify>,
    ) -> Arc<Machine> {
        let shared = Arc::new(Shared::new(session, runtime.clone(), client, record, inbox));
        let (stop, stopped) = oneshot::channel();
        runtime
            .handle()
            .spawn(pump::run(Arc::clone(&shared), stopped));
        Arc::new(Machine {
            shared,
            stop: Mutex::new(Some(stop)),
        })
    }

    pub(crate) fn shared(&self) -> &Arc<Shared> {
        &self.shared
    }

    pub fn id(&self) -> String {
        self.shared.session().machine_id().to_owned()
    }

    /// The record as it stands, with every `RecordChanged` applied.
    pub fn record(&self) -> MachineRecord {
        self.shared.lock().record.clone()
    }

    pub fn status(&self) -> MachineStatus {
        self.shared.lock().status()
    }

    /// The next thing the machine has to say; `None` once it has ended and everything was read.
    /// One reader at a time.
    pub async fn next_event(&self) -> Option<MachineEvent> {
        loop {
            let taken = events::take(&mut self.shared.lock());
            match taken {
                Taken::Event(event) => return Some(event),
                Taken::Closed => return None,
                Taken::Wait(notify) => wait::notified(self.shared.runtime(), &notify, None).await,
            }
        }
    }

    /// Sends one contract request and returns its answer, a `….result` message: the bridge's
    /// `error{…}` comes back as `ClientError::Refused`. Any `requestId` in `message` is replaced.
    /// Hello, attaches and detaches are the client's own (`attach`, `terminal`, the views).
    pub async fn request(&self, message: ClientMessage) -> Result<ServerMessage, ClientError> {
        self.shared.request(message).await
    }

    /// A view of `session`, attached now or as soon as the bridge is ready. Its first update is the
    /// session's snapshot.
    pub fn attach(self: Arc<Self>, session: SessionRef) -> Result<Arc<SessionView>, ClientError> {
        let subscriber = {
            let mut state = self.shared.lock();
            if let Some(error) = &state.ended {
                return Err(error.clone());
            }
            let (stream, subscriber) = state.streams.subscribe(&session)?;
            self.shared.attach_stream(&mut state, stream);
            subscriber
        };
        Ok(Arc::new(SessionView::new(self, subscriber)))
    }

    /// A view of the terminal `id` (from `term.open` or `term.list`), attached from its first byte
    /// the bridge still holds.
    pub fn terminal(self: Arc<Self>, id: TerminalId) -> Result<Arc<TerminalView>, ClientError> {
        let key = {
            let mut state = self.shared.lock();
            if let Some(error) = &state.ended {
                return Err(error.clone());
            }
            let key = state.terminals.open(id.clone())?;
            self.shared.attach_terminal(&mut state, key);
            key
        };
        Ok(Arc::new(TerminalView::new(self, key, id)))
    }

    pub(crate) fn leave_view(&self, subscriber: u64) {
        let mut state = self.shared.lock();
        if let Some(detach) = state.streams.unsubscribe(subscriber) {
            self.shared.detach(&mut state, detach);
        }
        drop(state);
        self.shared.poke_inbox();
    }

    pub(crate) fn leave_terminal(&self, key: u64) {
        let mut state = self.shared.lock();
        if let Some(detach) = state.terminals.close(key) {
            self.shared.detach(&mut state, detach);
        }
    }

    /// Has the machine seal its alerts for this push token, on every connect until replaced.
    pub fn register_push(&self, platform: PushPlatform, token: String) {
        self.shared.session().register_push(platform, token);
    }

    pub fn unregister_push(&self) {
        self.shared.session().unregister_push();
    }

    /// The app went to the background.
    pub fn pause(&self) {
        self.shared.session().pause();
    }

    pub fn resume(&self) {
        self.shared.session().resume();
    }

    /// The phone's network changed: every route is raced again and the link session resumes.
    pub fn network_changed(&self) {
        self.shared.session().network_changed();
    }

    /// `host:port` routes the platform's browse found for this machine, newest first.
    pub fn lan_discovered(&self, routes: Vec<String>) {
        self.shared.session().lan_discovered(routes);
    }

    /// Asks the machine to restart its bridge.
    pub fn restart_bridge(&self) -> Result<(), ClientError> {
        self.shared
            .session()
            .restart_bridge()
            .map_err(|failure| ClientError::NotSent { failure })
    }

    /// Ends the link session here and on the machine; every view ends.
    pub fn close(&self) {
        self.shared.session().close();
    }
}

impl Machine {
    /// Stops reading the link session without telling the machine, which a new pairing has given
    /// another session meanwhile; every view ends.
    pub(crate) fn retire(&self) {
        let stop = self
            .stop
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(stop) = stop {
            let _ = stop.send(());
        }
    }
}

impl Drop for Machine {
    fn drop(&mut self) {
        self.retire();
    }
}

/// An answer of a type the request does not take, named by its wire type.
pub(crate) fn unexpected(answer: &ServerMessage) -> ClientError {
    let kind = serde_json::to_value(answer)
        .ok()
        .and_then(|value| value.get("type")?.as_str().map(str::to_owned));
    ClientError::UnexpectedAnswer {
        answer: kind.unwrap_or_default(),
    }
}
