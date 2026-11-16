//! The inbox keeps a view open on each of a machine's newest sessions that wait on the person, so
//! their rows know the pending interaction and its options without the app opening a chat. The
//! views go when the row stops waiting, when the machine ends, and past the bound.

use std::sync::Arc;

use broski_contract::{SessionRef, SessionStatus};

use super::state::{Shared, State};

/// Sessions a machine keeps viewed for the inbox, newest first; the rest of its 32 views stay the
/// app's.
pub(crate) const MAX_HELD_SESSIONS: usize = 8;

impl State {
    /// Every inbox list's first page is in.
    pub(crate) fn inbox_loaded(&self) -> bool {
        let lists = &self.catalog.lists;
        self.catalog.backends().is_some()
            && self
                .catalog
                .inbox
                .iter()
                .all(|(_, id)| lists.get(*id).is_some_and(|list| list.loaded()))
    }

    /// The inbox's sessions waiting on the person, newest first, up to the bound.
    fn waiting(&self) -> Vec<SessionRef> {
        let lists = &self.catalog.lists;
        let mut waiting: Vec<(i64, &SessionRef)> = self
            .catalog
            .inbox
            .iter()
            .filter_map(|(_, id)| lists.get(*id))
            .flat_map(|list| list.rows())
            .filter(|row| row.status == SessionStatus::WaitingForUser)
            .map(|row| (row.updated_at, &row.session))
            .collect();
        waiting.sort_by(|a, b| (b.0, &b.1.session_id).cmp(&(a.0, &a.1.session_id)));
        waiting
            .into_iter()
            .take(MAX_HELD_SESSIONS)
            .map(|(_, session)| session.clone())
            .collect()
    }
}

impl Shared {
    /// Brings the inbox's views in line with the rows: a view for each waiting session, none for
    /// any other. Nothing changes until the rows are all in, so a new bridge socket, which lists
    /// everything again, does not drop views it is about to want back.
    pub(crate) fn hold_waiting(self: &Arc<Self>, state: &mut State) {
        if state.ended.is_some() || !state.inbox_loaded() {
            return;
        }
        let wanted = state.waiting();
        for (stream, session) in state.streams.held() {
            if !wanted.contains(&session) {
                if let Some(detach) = state.streams.release(stream) {
                    self.detach(state, detach);
                }
            }
        }
        for session in &wanted {
            match state.streams.hold(session) {
                Ok(Some(stream)) => self.attach_stream(state, stream),
                Ok(None) => {}
                Err(error) => {
                    tracing::debug!(%error, "the inbox views no more sessions");
                    break;
                }
            }
        }
    }
}
