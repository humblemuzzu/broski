use std::sync::Arc;

use broski_client as client;
use broski_client::{AnswerOutcome, ClientError, InboxRow, InboxUpdate, PendingAsk, SeenState};
use broski_contract::{
    InteractionId, InteractionKind, PermissionOption, RejectionCode, SessionRef,
};

/// The home screen: every session of every paired machine, by what it asks of the person. It lives
/// as long as the phone.
#[derive(uniffi::Object)]
pub struct Inbox(pub(crate) Arc<client::Inbox>);

#[uniffi::export]
impl Inbox {
    pub fn rows(&self) -> Vec<InboxRow> {
        self.0.rows()
    }

    /// The rows each time they, what the person has seen, or the cache change, at most 30 times a
    /// second. It never ends: one loop for the app's life reads it.
    pub async fn next_change(&self) -> InboxUpdate {
        self.0.next_change().await
    }

    /// Pull to refresh: machines whose bridge is ready reload their sessions, machines waiting to
    /// dial dial now; returns once the reloads are answered.
    pub async fn refresh(&self) {
        self.0.refresh().await;
    }

    /// The person opened or left the session: it is not `Done` again until something happens.
    pub fn mark_seen(&self, machine_id: String, session: SessionRef) {
        self.0.mark_seen(machine_id, session);
    }

    pub fn seen(&self) -> SeenState {
        self.0.seen()
    }

    /// What the app persisted from `InboxUpdate.seen`, at its start and before any machine starts.
    pub fn restore_seen(&self, state: SeenState) {
        self.0.restore_seen(state);
    }

    /// What the app persisted from `InboxUpdate.cache`, at its start and before any machine starts.
    /// Throws `InvalidRequest` for bytes that are not a cache of this version, changing nothing.
    pub fn restore_cache(&self, cache: Vec<u8>) -> Result<(), ClientError> {
        self.0.restore_cache(cache)
    }

    /// The person tapped Approve or Deny on a row: answers its `pending` ask with `optionId`, which
    /// must be that ask's `allow.id` or `deny.id`.
    pub async fn answer(
        &self,
        machine_id: String,
        session: SessionRef,
        interaction_id: String,
        option_id: String,
    ) -> Result<AnswerOutcome, ClientError> {
        self.0
            .answer(machine_id, session, interaction_id, option_id)
            .await
    }
}

#[uniffi::remote(Record)]
pub struct PendingAsk {
    pub interaction_id: InteractionId,
    pub kind: InteractionKind,
    pub allow: Option<PermissionOption>,
    pub deny: Option<PermissionOption>,
}

#[uniffi::remote(Enum)]
pub enum AnswerOutcome {
    Accepted,
    Stale,
    Rejected { code: RejectionCode, detail: String },
}
