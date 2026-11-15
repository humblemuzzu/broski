//! What the person has seen, as plain data the app persists: per session, the `updatedAt` its row had
//! when they last looked, and the machines whose history was already marked. The core does no storage
//! I/O.

use std::collections::{HashMap, HashSet};

use broski_contract::{BackendId, SessionRef};

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

#[derive(Default)]
pub(crate) struct Seen {
    markers: HashMap<Key, i64>,
    /// Machines whose history is marked; persisted.
    read: HashSet<String>,
    /// Machines whose rows were all in during this run.
    settled: HashSet<String>,
    /// The state changed since the app last took it.
    pub(crate) changed: bool,
}

impl Seen {
    pub(crate) fn get(&self, machine_id: &str, session: &SessionRef) -> Option<i64> {
        self.markers.get(&key(machine_id, session)).copied()
    }

    pub(crate) fn mark(&mut self, machine_id: &str, session: &SessionRef, seen_at: i64) {
        self.markers.insert(key(machine_id, session), seen_at);
        self.changed = true;
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
