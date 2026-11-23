//! What the person has seen, as plain data the app persists: per session, the `updatedAt` its row had
//! when they last looked, the sessions they marked unread, and the machines whose history was already
//! marked. The core does no storage I/O.

use std::collections::{HashMap, HashSet};

use broski_contract::{BackendId, SessionRef, SessionStatus};

use super::rows::DONE_WINDOW_MS;
use crate::machine::InboxSource;

#[derive(Debug, Clone, PartialEq)]
pub struct SeenMarker {
    pub machine_id: String,
    pub session: SessionRef,
    /// The row's `updatedAt` when the person last saw the session.
    pub seen_at: i64,
}

/// A session the person marked unread: it settles as `Done`, however old, until they see it again.
#[derive(Debug, Clone, PartialEq)]
pub struct UnreadSession {
    pub machine_id: String,
    pub session: SessionRef,
}

/// A machine's history: every session whose `updatedAt` is at or before `through` had happened when the
/// machine's rows first came in, and counts as seen unless the person marked it unread.
#[derive(Debug, Clone, PartialEq)]
pub struct MachineHistory {
    pub machine_id: String,
    pub through: i64,
}

/// Everything the app persists of what the person has seen.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SeenState {
    pub markers: Vec<SeenMarker>,
    /// The machines whose history was marked seen when its rows first came in. A machine that had no
    /// session then has no history to say so, and would have its next sessions marked at the next start.
    pub read_machines: Vec<String>,
    /// No session is both here and in `markers`.
    pub unread: Vec<UnreadSession>,
    /// Each read machine's history; a session no page has loaded yet is covered by it too.
    pub histories: Vec<MachineHistory>,
}

/// What the person last did with a session, as its settled row reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mark {
    Unseen,
    SeenAt(i64),
    Unread,
}

type Key = (String, BackendId, String);

fn key(machine_id: &str, session: &SessionRef) -> Key {
    (
        machine_id.to_owned(),
        session.backend.clone(),
        session.session_id.clone(),
    )
}

fn active(status: SessionStatus) -> bool {
    matches!(
        status,
        SessionStatus::Running | SessionStatus::WaitingForUser
    )
}

/// The row shows activity that the view the phone holds has already seen end.
fn lags(source: &InboxSource) -> bool {
    let settled_live = source
        .live
        .as_ref()
        .is_some_and(|live| !live.working && !live.needs_you);
    settled_live && active(source.row.status)
}

#[derive(Default)]
pub(crate) struct Seen {
    markers: HashMap<Key, i64>,
    /// Machines whose history is marked; persisted.
    read: HashSet<String>,
    /// The newest `updatedAt` each machine's first read saw; persisted.
    history: HashMap<String, i64>,
    /// Machines whose rows were all in during this run.
    settled: HashSet<String>,
    /// Sessions seen while their row could not say what the person saw: the row is not in yet, or
    /// still shows a run or an ask the person's own view has seen end. Marking its `updatedAt` then
    /// would leave the session done again when the row catches up. Each is marked when its row settles.
    deferred: HashSet<Key>,
    /// Sessions the person marked unread; persisted.
    unread: HashSet<Key>,
    /// The state changed since the app last took it.
    pub(crate) changed: bool,
}

impl Seen {
    pub(crate) fn get(&self, machine_id: &str, session: &SessionRef) -> Mark {
        let key = key(machine_id, session);
        if self.unread.contains(&key) {
            return Mark::Unread;
        }
        let marker = self.markers.get(&key).copied();
        let history = self.history.get(machine_id).copied();
        marker.max(history).map_or(Mark::Unseen, Mark::SeenAt)
    }

    /// The person has seen `session`, whose inbox row is `source` when it is listed.
    pub(crate) fn see(
        &mut self,
        machine_id: &str,
        session: &SessionRef,
        source: Option<&InboxSource>,
    ) {
        match source {
            Some(source) if !lags(source) => self.mark(machine_id, session, source.row.updated_at),
            _ => {
                let key = key(machine_id, session);
                self.changed |= self.unread.remove(&key);
                self.deferred.insert(key);
            }
        }
    }

    /// The person has seen `session` as the cached row its machine's unloaded lists stand in for.
    pub(crate) fn see_cached(&mut self, machine_id: &str, session: &SessionRef, updated_at: i64) {
        self.deferred.remove(&key(machine_id, session));
        self.mark(machine_id, session, updated_at);
    }

    /// Marks the deferred sessions of `machine_id` whose row has settled.
    pub(crate) fn resolve(&mut self, machine_id: &str, rows: &[InboxSource]) {
        if self.deferred.is_empty() {
            return;
        }
        for source in rows.iter().filter(|source| !active(source.row.status)) {
            let session = &source.row.session;
            if self.deferred.remove(&key(machine_id, session)) {
                self.mark(machine_id, session, source.row.updated_at);
            }
        }
    }

    fn mark(&mut self, machine_id: &str, session: &SessionRef, seen_at: i64) {
        let key = key(machine_id, session);
        self.changed |= self.unread.remove(&key);
        if self
            .markers
            .get(&key)
            .is_some_and(|known| *known >= seen_at)
        {
            return;
        }
        self.markers.insert(key, seen_at);
        self.changed = true;
    }

    pub(crate) fn mark_at(&mut self, machine_id: &str, session: &SessionRef, seen_at: i64) {
        self.mark(machine_id, session, seen_at);
    }

    /// The person wants `session` back in `Done` until they see it again.
    pub(crate) fn unsee(&mut self, machine_id: &str, session: &SessionRef) {
        let key = key(machine_id, session);
        self.deferred.remove(&key);
        let had_marker = self.markers.remove(&key).is_some();
        let inserted = self.unread.insert(key);
        self.changed |= had_marker || inserted;
    }

    pub(crate) fn restore(&mut self, state: SeenState) {
        self.markers = state
            .markers
            .into_iter()
            .map(|marker| (key(&marker.machine_id, &marker.session), marker.seen_at))
            .collect();
        self.read = state.read_machines.into_iter().collect();
        self.history = (state.histories.into_iter())
            .map(|history| (history.machine_id, history.through))
            .collect();
        self.unread = state
            .unread
            .into_iter()
            .map(|unread| key(&unread.machine_id, &unread.session))
            .collect();
        for unread in &self.unread {
            self.markers.remove(unread);
        }
    }

    pub(crate) fn forget_machine(&mut self, machine_id: &str) {
        let before = self.markers.len() + self.unread.len();
        self.markers
            .retain(|(machine, _, _), _| machine != machine_id);
        self.unread.retain(|(machine, _, _)| machine != machine_id);
        self.history.remove(machine_id);
        self.settled.remove(machine_id);
        self.deferred
            .retain(|(machine, _, _)| machine != machine_id);
        let was_read = self.read.remove(machine_id);
        self.changed |= was_read || self.markers.len() + self.unread.len() != before;
    }

    /// The first time a machine's rows are all in during a run. One whose history was never marked
    /// starts with everything up to its newest row seen, loaded or not, so a first pairing does not show
    /// its history as done however far the person scrolls. For one that was, markers no longer able to
    /// change a row go (see `prune`), and unread marks of sessions no longer listed are dropped.
    pub(crate) fn first_read(&mut self, machine_id: &str, rows: &[InboxSource], now_ms: i64) {
        if !self.settled.insert(machine_id.to_owned()) {
            return;
        }
        if self.read.insert(machine_id.to_owned()) {
            if let Some(through) = rows.iter().map(|source| source.row.updated_at).max() {
                self.history.insert(machine_id.to_owned(), through);
            }
            self.changed = true;
            return;
        }
        if !self.history.contains_key(machine_id) {
            self.adopt_history(machine_id);
        }
        let listed: HashSet<Key> = rows
            .iter()
            .map(|source| key(machine_id, &source.row.session))
            .collect();
        let before = self.unread.len();
        self.unread
            .retain(|unread| unread.0 != machine_id || listed.contains(unread));
        self.changed |= self.unread.len() != before;
        self.prune(machine_id, now_ms);
    }

    /// A machine read before histories were kept: its newest marker is as far as the person is known
    /// to have seen, so nothing newer than that is taken for seen.
    fn adopt_history(&mut self, machine_id: &str) {
        let newest = (self.markers.iter())
            .filter(|(marker, _)| marker.0 == machine_id)
            .map(|(_, seen_at)| *seen_at)
            .max();
        if let Some(through) = newest {
            self.history.insert(machine_id.to_owned(), through);
            self.changed = true;
        }
    }

    /// Drops the machine's markers that can no longer change a row: one the history covers, and one
    /// older than `DONE_WINDOW_MS`, since a row that recent is newer than it and one older is idle anyway.
    /// Markers of sessions no page has loaded stay, so scrolling down finds them as the person left them.
    fn prune(&mut self, machine_id: &str, now_ms: i64) {
        let history = self.history.get(machine_id).copied().unwrap_or(i64::MIN);
        let oldest = now_ms.saturating_sub(DONE_WINDOW_MS);
        let before = self.markers.len();
        self.markers.retain(|marker, seen_at| {
            marker.0 != machine_id || (*seen_at > history && *seen_at >= oldest)
        });
        self.changed |= self.markers.len() != before;
    }

    pub(crate) fn state(&self) -> SeenState {
        let mut markers: Vec<SeenMarker> = self
            .markers
            .iter()
            .map(|((machine_id, backend, session_id), seen_at)| SeenMarker {
                machine_id: machine_id.clone(),
                session: SessionRef {
                    backend: backend.clone(),
                    session_id: session_id.clone(),
                },
                seen_at: *seen_at,
            })
            .collect();
        markers.sort_by(|a, b| {
            (&a.machine_id, &a.session.backend, &a.session.session_id).cmp(&(
                &b.machine_id,
                &b.session.backend,
                &b.session.session_id,
            ))
        });
        let mut read_machines: Vec<String> = self.read.iter().cloned().collect();
        read_machines.sort();
        let mut unread: Vec<&Key> = self.unread.iter().collect();
        unread.sort();
        let unread = unread
            .into_iter()
            .map(|(machine_id, backend, session_id)| UnreadSession {
                machine_id: machine_id.clone(),
                session: SessionRef {
                    backend: backend.clone(),
                    session_id: session_id.clone(),
                },
            })
            .collect();
        let mut histories: Vec<MachineHistory> = (self.history.iter())
            .map(|(machine_id, through)| MachineHistory {
                machine_id: machine_id.clone(),
                through: *through,
            })
            .collect();
        histories.sort_by(|a, b| a.machine_id.cmp(&b.machine_id));
        SeenState {
            markers,
            read_machines,
            unread,
            histories,
        }
    }
}

#[cfg(test)]
#[path = "seen_tests.rs"]
mod tests;
