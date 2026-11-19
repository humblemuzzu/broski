use std::sync::Arc;

use broski_client as client;
use broski_client::{ClientError, MachineEvent, MachineStatus};
use broski_contract::{
    BackendDescriptor, BackendId, BackendStatus, ClientMessage, CommandsListResult,
    ModelsListResult, ModesListResult, ServerMessage, SessionQuery, SessionRef, TerminalId,
};
use broski_link_session::PushPlatform;

use crate::record::MachineRecord;
use crate::views::{SessionList, SessionView, TerminalView};

/// One paired machine: the contract over its link, its catalog, and the views opened on it.
#[derive(uniffi::Object)]
pub struct Machine(Arc<client::Machine>);

impl Machine {
    pub(crate) fn wrap(machine: Arc<client::Machine>) -> Arc<Machine> {
        Arc::new(Machine(machine))
    }
}

#[uniffi::export]
impl Machine {
    pub fn id(&self) -> String {
        self.0.id()
    }

    /// The record as it stands, to persist after pairing and after every `RecordChanged`.
    pub fn record(&self) -> Arc<MachineRecord> {
        Arc::new(MachineRecord(self.0.record()))
    }

    pub fn status(&self) -> MachineStatus {
        self.0.status()
    }

    /// The next event; `None` once the machine has ended (forgotten, replaced or revoked) and
    /// everything was read. One reader at a time.
    pub async fn next_event(&self) -> Option<MachineEvent> {
        self.0.next_event().await
    }

    /// Any contract request but hello, attaches and detaches; the answer is the `….result` message,
    /// and the bridge's `error{…}` is `ClientError.Refused`.
    pub async fn request(&self, message: ClientMessage) -> Result<ServerMessage, ClientError> {
        self.0.request(message).await
    }

    /// A view of `session`, attached now or as soon as the bridge is ready.
    pub fn attach(&self, session: SessionRef) -> Result<Arc<SessionView>, ClientError> {
        Arc::clone(&self.0)
            .attach(session)
            .map(|view| Arc::new(SessionView(view)))
    }

    /// A view of the terminal `id`, from `term.open` or `term.list`.
    pub fn terminal(&self, id: TerminalId) -> Result<Arc<TerminalView>, ClientError> {
        Arc::clone(&self.0)
            .terminal(id)
            .map(|view| Arc::new(TerminalView(view)))
    }

    /// `backend`'s sessions newest first, kept current; `query.cwd` spelled as the bridge spells
    /// directories.
    pub fn session_list(
        &self,
        backend: BackendId,
        query: SessionQuery,
    ) -> Result<Arc<SessionList>, ClientError> {
        Arc::clone(&self.0)
            .session_list(backend, query)
            .map(|list| Arc::new(SessionList(list)))
    }

    pub async fn backends(&self) -> Result<Vec<BackendDescriptor>, ClientError> {
        self.0.backends().await
    }

    pub async fn backend_status(&self, backend: BackendId) -> Result<BackendStatus, ClientError> {
        self.0.backend_status(backend).await
    }

    pub async fn models(
        &self,
        backend: BackendId,
        cwd: Option<String>,
        include_unavailable: bool,
    ) -> Result<ModelsListResult, ClientError> {
        self.0.models(backend, cwd, include_unavailable).await
    }

    pub async fn commands(
        &self,
        backend: BackendId,
        cwd: Option<String>,
        session: Option<SessionRef>,
    ) -> Result<CommandsListResult, ClientError> {
        self.0.commands(backend, cwd, session).await
    }

    pub async fn modes(
        &self,
        backend: BackendId,
        cwd: Option<String>,
    ) -> Result<ModesListResult, ClientError> {
        self.0.modes(backend, cwd).await
    }

    /// Has the machine seal its alerts for this push token, on every connect until replaced.
    pub fn register_push(&self, platform: PushPlatform, token: String) {
        self.0.register_push(platform, token);
    }

    pub fn unregister_push(&self) {
        self.0.unregister_push();
    }

    /// Registers the active iOS Live Activity push token so the machine can update it while the app
    /// is in the background.
    pub fn register_live_activity(&self, token: String) {
        self.0.register_live_activity(token);
    }

    pub fn unregister_live_activity(&self) {
        self.0.unregister_live_activity();
    }

    /// `host:port` routes the platform's browse (`NWBrowser`, `NsdManager`) found for this machine,
    /// newest first.
    pub fn lan_discovered(&self, routes: Vec<String>) {
        self.0.lan_discovered(routes);
    }

    /// Asks the machine to restart its bridge.
    pub fn restart_bridge(&self) -> Result<(), ClientError> {
        self.0.restart_bridge()
    }
}
