//! What the person has seen, as plain data the app persists: per session, the `updatedAt` its row had
//! when they last looked. The core does no storage I/O.

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
    /// Machines whose rows were first read in full during this run.
    read: HashSet<String>,
    /// The markers changed since the app last took them.
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

    pub(crate) fn restore(&mut self, markers: Vec<SeenMarker>) {
        self.markers = markers
            .into_iter()
            .map(|marker| (key(&marker.machine_id, &marker.session), marker.seen_at))
            .collect();
    }

    pub(crate) fn forget_machine(&mut self, machine_id: &str) {
        let before = self.markers.len();
        self.markers
            .retain(|(machine, _, _), _| machine != machine_id);
        self.read.remove(machine_id);
        self.changed |= self.markers.len() != before;
    }

    /// The first time a machine's rows are all in: a machine this phone never marked a session of
    /// starts with every session seen, so a first pairing does not show its whole history as done;
    /// for one it has, markers of sessions no longer listed are dropped, which keeps them bounded by
    /// the rows.
    pub(crate) fn first_read(&mut self, machine_id: &str, rows: &[InboxSource]) {
        if !self.read.insert(machine_id.to_owned()) {
            return;
        }
        let known = self
            .markers
            .keys()
            .any(|(machine, _, _)| machine == machine_id);
        if known {
            let listed: HashSet<Key> = rows
                .iter()
                .map(|source| key(machine_id, &source.row.session))
                .collect();
            let before = self.markers.len();
            self.markers
                .retain(|marker, _| marker.0 != machine_id || listed.contains(marker));
            self.changed |= self.markers.len() != before;
        } else {
            for source in rows {
                self.markers
                    .insert(key(machine_id, &source.row.session), source.row.updated_at);
                self.changed = true;
            }
        }
    }

    pub(crate) fn markers(&self) -> Vec<SeenMarker> {
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
        markers
    }
}
