//! The screens' subscriptions on one machine. Each is pulled by one loop at a time and stopped by its
//! `detach` or `stop`, which makes a pull in progress return `None`; releasing the object stops it
//! too, once no pull holds it.

use std::sync::Arc;

use broski_client as client;
use broski_client::{ClientError, SessionListUpdate, SessionUpdate, TerminalUpdate};
use broski_contract::{
    ActionResult, SessionCapabilities, SessionRef, SessionSnapshot, TerminalId, TerminalSummary,
};

/// A chat screen's session: the snapshot first, then change records to apply in order.
#[derive(uniffi::Object)]
pub struct SessionView(pub(crate) Arc<client::SessionView>);

#[uniffi::export]
impl SessionView {
    /// The next update; `None` after `Ended` or once detached.
    pub async fn next_update(&self) -> Option<SessionUpdate> {
        self.0.next_update().await
    }

    /// The live state now, once the session has been attached.
    pub fn snapshot(&self) -> Option<SessionSnapshot> {
        self.0.snapshot()
    }

    /// The session viewed now, which a replacement changes.
    pub fn session(&self) -> Option<SessionRef> {
        self.0.session()
    }

    pub fn capabilities(&self) -> Option<SessionCapabilities> {
        self.0.capabilities()
    }

    /// Stops the view; the last view of a session detaches it on the bridge.
    pub fn detach(&self) {
        self.0.close();
    }
}

/// A terminal screen's bytes for its emulator, and its input and size back.
#[derive(uniffi::Object)]
pub struct TerminalView(pub(crate) Arc<client::TerminalView>);

#[uniffi::export]
impl TerminalView {
    pub fn id(&self) -> TerminalId {
        self.0.id()
    }

    /// The next update; `None` after `Exited` or `Failed`, or once detached.
    pub async fn next_update(&self) -> Option<TerminalUpdate> {
        self.0.next_update().await
    }

    /// The terminal as the bridge last described it.
    pub fn summary(&self) -> Option<TerminalSummary> {
        self.0.summary()
    }

    /// Key bytes as the emulator encoded them, delivered in the order sent.
    pub async fn input(&self, data: Vec<u8>) -> Result<ActionResult, ClientError> {
        self.0.input(data).await
    }

    /// The size in cells, and in pixels when the cell size is known.
    pub async fn resize(
        &self,
        cols: i64,
        rows: i64,
        cell_width: Option<i64>,
        cell_height: Option<i64>,
    ) -> Result<ActionResult, ClientError> {
        self.0.resize(cols, rows, cell_width, cell_height).await
    }

    /// Stops the view; the terminal goes on running on the machine.
    pub fn detach(&self) {
        self.0.close();
    }
}

/// One screen's list of sessions, page by page, kept current by the bridge's catalog.
#[derive(uniffi::Object)]
pub struct SessionList(pub(crate) Arc<client::SessionList>);

#[uniffi::export]
impl SessionList {
    pub fn rows(&self) -> SessionListUpdate {
        self.0.rows()
    }

    /// The rows each time they change; `None` once stopped or the machine ended.
    pub async fn next_change(&self) -> Option<SessionListUpdate> {
        self.0.next_change().await
    }

    /// The next page; nothing when one is on its way or there is no more.
    pub async fn load_more(&self) -> Result<(), ClientError> {
        self.0.load_more().await
    }

    /// The first page again, in place of every row.
    pub async fn refresh(&self) -> Result<(), ClientError> {
        self.0.refresh().await
    }

    pub fn stop(&self) {
        self.0.close();
    }
}
