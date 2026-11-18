//! What the person has seen, as plain data the app persists: per session, the `updatedAt` its row had
//! when they last looked, and the machines whose history was already marked. The core does no storage
//! I/O.

use std::collections::{HashMap, HashSet};

use broski_contract::{BackendId, SessionRef, SessionStatus};

use crate::machine::InboxSource;

#[derive(Debug, Clone, PartialEq)]
pub struct SeenMarker {
    pub machine_id: String,
    pub session: SessionRef,
    /// The row's `updatedAt` when the person last saw the session.
    pub seen_at: i64,
}

/// Everything the app persists of what the person has seen.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SeenState {
    pub markers: Vec<SeenMarker>,
    /// The machines whose history was marked seen when its rows first came in. A machine that had no
    /// session then has no marker to say so, and would have its next sessions marked at the next start.
    pub read_machines: Vec<String>,
}

type Key = (String, BackendId, String);

fn key(machine_id: &str, session: &SessionRef) -> Key {
    (
        machine_id.to_owned(),
        session.backend,
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
    /// Machines whose rows were all in during this run.
    settled: HashSet<String>,
    /// Sessions seen while their row could not say what the person saw: the row is not in yet, or
    /// still shows a run or an ask the person's own view has seen end. Marking its `updatedAt` then
    /// would leave the session done again when the row catches up. Each is marked when its row settles.
    deferred: HashSet<Key>,
    /// The state changed since the app last took it.
    pub(crate) changed: bool,
}

impl Seen {
    pub(crate) fn get(&self, machine_id: &str, session: &SessionRef) -> Option<i64> {
        self.markers.get(&key(machine_id, session)).copied()
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
                self.deferred.insert(key(machine_id, session));
            }
        }
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

    pub(crate) fn restore(&mut self, state: SeenState) {
        self.markers = state
            .markers
            .into_iter()
            .map(|marker| (key(&marker.machine_id, &marker.session), marker.seen_at))
            .collect();
        self.read = state.read_machines.into_iter().collect();
    }

    pub(crate) fn forget_machine(&mut self, machine_id: &str) {
        let before = self.markers.len();
        self.markers
            .retain(|(machine, _, _), _| machine != machine_id);
        self.settled.remove(machine_id);
        self.deferred
            .retain(|(machine, _, _)| machine != machine_id);
        let was_read = self.read.remove(machine_id);
        self.changed |= was_read || self.markers.len() != before;
    }

    /// The first time a machine's rows are all in during a run. One whose history was never marked
    /// starts with every session seen, so a first pairing does not show its history as done; for one
    /// that was, markers of sessions no longer listed are dropped, which keeps them bounded by the
    /// rows.
    pub(crate) fn first_read(&mut self, machine_id: &str, rows: &[InboxSource]) {
        if !self.settled.insert(machine_id.to_owned()) {
            return;
        }
        if self.read.insert(machine_id.to_owned()) {
            for source in rows {
                self.markers
                    .insert(key(machine_id, &source.row.session), source.row.updated_at);
            }
            self.changed = true;
        } else {
            let listed: HashSet<Key> = rows
                .iter()
                .map(|source| key(machine_id, &source.row.session))
                .collect();
            let before = self.markers.len();
            self.markers
                .retain(|marker, _| marker.0 != machine_id || listed.contains(marker));
            self.changed |= self.markers.len() != before;
        }
    }

    pub(crate) fn state(&self) -> SeenState {
        let mut markers: Vec<SeenMarker> = self
            .markers
            .iter()
            .map(|((machine_id, backend, session_id), seen_at)| SeenMarker {
                machine_id: machine_id.clone(),
                session: SessionRef {
                    backend: *backend,
                    session_id: session_id.clone(),
                },
                seen_at: *seen_at,
            })
            .collect();
        markers.sort_by(|a, b| {
            (&a.machine_id, &a.session.session_id).cmp(&(&b.machine_id, &b.session.session_id))
        });
        let mut read_machines: Vec<String> = self.read.iter().cloned().collect();
        read_machines.sort();
        SeenState {
            markers,
            read_machines,
        }
    }
}

#[cfg(test)]
mod tests {
    use broski_contract::{SessionOrigin, SessionSummary};

    use super::*;
    use crate::view::stream::LiveInfo;

    const MACHINE: &str = "m";

    fn session() -> SessionRef {
        SessionRef {
            backend: BackendId::Pi,
            session_id: "s".to_owned(),
        }
    }

    fn source(status: SessionStatus, updated_at: i64, live: Option<LiveInfo>) -> InboxSource {
        let row = SessionSummary {
            session: session(),
            title: None,
            cwd: None,
            created_at: None,
            updated_at,
            parent: None,
            model_id: None,
            status,
            origin: SessionOrigin::Broski,
            source: None,
        };
        InboxSource { row, live }
    }

    fn live(working: bool, needs_you: bool) -> LiveInfo {
        LiveInfo {
            ask: None,
            command: None,
            pending: None,
            needs_you,
            working,
        }
    }

    fn marker(seen: &Seen) -> Option<i64> {
        seen.get(MACHINE, &session())
    }

    #[test]
    fn a_session_whose_row_is_current_is_marked_at_its_updated_at() {
        let mut seen = Seen::default();
        let idle = source(SessionStatus::Idle, 10, Some(live(false, false)));
        seen.see(MACHINE, &session(), Some(&idle));
        assert_eq!(marker(&seen), Some(10));
        let running = source(SessionStatus::Running, 20, Some(live(true, false)));
        seen.see(MACHINE, &session(), Some(&running));
        assert_eq!(marker(&seen), Some(20), "a run the person watches");
    }

    #[test]
    fn a_marker_never_moves_back() {
        let mut seen = Seen::default();
        seen.see(
            MACHINE,
            &session(),
            Some(&source(SessionStatus::Idle, 20, None)),
        );
        seen.see(
            MACHINE,
            &session(),
            Some(&source(SessionStatus::Idle, 10, None)),
        );
        assert_eq!(marker(&seen), Some(20));
    }

    #[test]
    fn a_session_not_listed_yet_is_marked_when_its_row_comes_in() {
        let mut seen = Seen::default();
        seen.see(MACHINE, &session(), None);
        assert_eq!(marker(&seen), None);
        seen.resolve(MACHINE, &[source(SessionStatus::Idle, 10, None)]);
        assert_eq!(marker(&seen), Some(10));
        seen.resolve(MACHINE, &[source(SessionStatus::Idle, 30, None)]);
        assert_eq!(marker(&seen), Some(10), "marked once");
    }

    #[test]
    fn a_row_still_running_after_the_view_saw_the_run_end_waits_for_its_update() {
        for status in [SessionStatus::Running, SessionStatus::WaitingForUser] {
            let mut seen = Seen::default();
            let stale = source(status, 10, Some(live(false, false)));
            seen.see(MACHINE, &session(), Some(&stale));
            assert_eq!(marker(&seen), None, "{status:?}");
            seen.resolve(MACHINE, &[source(status, 10, None)]);
            assert_eq!(marker(&seen), None, "still {status:?}");
            seen.resolve(MACHINE, &[source(SessionStatus::Idle, 25, None)]);
            assert_eq!(marker(&seen), Some(25), "the run's own update is seen");
        }
    }

    #[test]
    fn forgetting_a_machine_drops_its_waiting_marks() {
        let mut seen = Seen::default();
        seen.see(MACHINE, &session(), None);
        seen.forget_machine(MACHINE);
        seen.resolve(MACHINE, &[source(SessionStatus::Idle, 10, None)]);
        assert_eq!(marker(&seen), None);
    }
}
