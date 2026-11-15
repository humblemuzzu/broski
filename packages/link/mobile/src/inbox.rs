use std::sync::Arc;

use broski_client as client;
use broski_client::{InboxRow, InboxUpdate, SeenMarker};
use broski_contract::SessionRef;

/// The home screen: every session of every paired machine, by what it asks of the person. It lives
/// as long as the phone.
#[derive(uniffi::Object)]
pub struct Inbox(pub(crate) Arc<client::Inbox>);

#[uniffi::export]
impl Inbox {
    pub fn rows(&self) -> Vec<InboxRow> {
        self.0.rows()
    }

    /// The rows each time they or the seen markers change, at most 30 times a second. It never
    /// ends: one loop for the app's life reads it.
    pub async fn next_change(&self) -> InboxUpdate {
        self.0.next_change().await
    }

    /// The person opened or left the session: it is not `Done` again until something happens.
    pub fn mark_seen(&self, machine_id: String, session: SessionRef) {
        self.0.mark_seen(machine_id, session);
    }

    pub fn seen(&self) -> Vec<SeenMarker> {
        self.0.seen()
    }

    /// The markers the app persisted from `InboxUpdate.seen`, at its start.
    pub fn restore_seen(&self, markers: Vec<SeenMarker>) {
        self.0.restore_seen(markers);
    }
}
