use std::sync::Arc;

use broski_contract::SessionSummary;

use crate::error::ClientError;
use crate::machine::Machine;
use crate::wait;

/// A session list's rows as they stand.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionListUpdate {
    /// Newest first, one per session.
    pub rows: Vec<SessionSummary>,
    /// More rows than these exist: `load_more` reads the next page.
    pub has_more: bool,
}

/// One screen's list of sessions. Rows arrive page by page and stay current by themselves.
pub struct SessionList {
    machine: Arc<Machine>,
    id: u64,
}

impl SessionList {
    pub(crate) fn new(machine: Arc<Machine>, id: u64) -> SessionList {
        SessionList { machine, id }
    }

    pub fn rows(&self) -> SessionListUpdate {
        let state = self.machine.shared().lock();
        state
            .catalog
            .lists
            .get(self.id)
            .map_or_else(SessionListUpdate::empty, |list| SessionListUpdate {
                rows: list.rows().to_vec(),
                has_more: list.has_more(),
            })
    }

    /// The next page; nothing when one is already on its way or there is no more.
    pub async fn load_more(&self) -> Result<(), ClientError> {
        self.machine.shared().load(self.id, false).await
    }

    /// The first page again, in place of every row.
    pub async fn refresh(&self) -> Result<(), ClientError> {
        self.machine.shared().load(self.id, true).await
    }

    /// The rows each time they change; `None` once the list is closed or the machine ended.
    pub async fn next_change(&self) -> Option<SessionListUpdate> {
        loop {
            let notify = {
                let mut state = self.machine.shared().lock();
                if state.ended.is_some() {
                    return None;
                }
                let list = state.catalog.lists.get_mut(self.id)?;
                if list.take_change() {
                    return Some(SessionListUpdate {
                        rows: list.rows().to_vec(),
                        has_more: list.has_more(),
                    });
                }
                Arc::clone(&list.notify)
            };
            wait::notified(self.machine.shared().runtime(), &notify, None).await;
        }
    }

    /// Stops the list; dropping it does the same.
    pub fn close(&self) {
        self.machine.shared().lock().catalog.lists.remove(self.id);
    }
}

impl SessionListUpdate {
    fn empty() -> SessionListUpdate {
        SessionListUpdate {
            rows: Vec::new(),
            has_more: false,
        }
    }
}

impl Drop for SessionList {
    fn drop(&mut self) {
        self.close();
    }
}
