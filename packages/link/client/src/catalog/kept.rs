//! The sessions the person pinned on this machine. The inbox shows each whether or not one of its lists
//! holds it: a pinned session no list holds is read with `session.get`, and the catalog's rows keep it
//! current as they keep the lists.

use std::collections::HashMap;

use broski_contract::{SessionRef, SessionSummary};

enum Known {
    /// Not read yet, or read on a bridge socket that is gone.
    Unknown,
    Asking,
    Read(SessionSummary),
    /// The machine has no such session: it was deleted.
    Missing,
}

fn key(session: &SessionRef) -> (String, String) {
    (session.backend.clone(), session.session_id.clone())
}

#[derive(Default)]
pub(crate) struct Kept {
    sessions: HashMap<(String, String), (SessionRef, Known)>,
    /// Bumped by every change of what the inbox would show of them.
    version: u64,
}

impl Kept {
    /// The pinned sessions now: those no longer pinned go, new ones are read when no list holds them.
    pub(crate) fn set(&mut self, sessions: impl IntoIterator<Item = SessionRef>) {
        let mut next = HashMap::new();
        for session in sessions {
            let key = key(&session);
            let known = self
                .sessions
                .remove(&key)
                .map_or(Known::Unknown, |(_, known)| known);
            next.insert(key, (session, known));
        }
        self.sessions = next;
        self.version += 1;
    }

    pub(crate) fn contains(&self, session: &SessionRef) -> bool {
        self.sessions.contains_key(&key(session))
    }

    pub(crate) fn version(&self) -> u64 {
        self.version
    }

    /// The pinned sessions to read now, each marked as being read; `listed` says which a list holds.
    pub(crate) fn start_reads(&mut self, listed: impl Fn(&SessionRef) -> bool) -> Vec<SessionRef> {
        let mut wanted = Vec::new();
        for (session, known) in self.sessions.values_mut() {
            if matches!(known, Known::Unknown) && !listed(session) {
                *known = Known::Asking;
                wanted.push(session.clone());
            }
        }
        wanted
    }

    /// What `session.get` said: the row, `None` for a session the machine does not have, or a failure
    /// that leaves the session to be read again.
    pub(crate) fn read(
        &mut self,
        session: &SessionRef,
        outcome: Result<Option<SessionSummary>, ()>,
    ) {
        let Some((_, known)) = self.sessions.get_mut(&key(session)) else {
            return;
        };
        *known = match outcome {
            Ok(Some(row)) => Known::Read(row),
            Ok(None) => Known::Missing,
            Err(()) => Known::Unknown,
        };
        self.version += 1;
    }

    /// A new bridge socket: what was read may have changed while nobody listened.
    pub(crate) fn forget_reads(&mut self) {
        for (_, known) in self.sessions.values_mut() {
            *known = Known::Unknown;
        }
        self.version += 1;
    }

    /// A row the catalog sent.
    pub(crate) fn updated(&mut self, row: &SessionSummary) {
        if let Some((_, known)) = self.sessions.get_mut(&key(&row.session)) {
            *known = Known::Read(row.clone());
            self.version += 1;
        }
    }

    pub(crate) fn removed(&mut self, session: &SessionRef) {
        if let Some((_, known)) = self.sessions.get_mut(&key(session)) {
            *known = Known::Missing;
            self.version += 1;
        }
    }

    /// The rows read of pinned sessions.
    pub(crate) fn rows(&self) -> impl Iterator<Item = &SessionSummary> {
        self.sessions.values().filter_map(|(_, known)| match known {
            Known::Read(row) => Some(row),
            _ => None,
        })
    }
}

#[cfg(test)]
mod tests {
    use broski_contract::{SessionOrigin, SessionStatus};

    use super::*;

    fn session(id: &str) -> SessionRef {
        SessionRef {
            backend: "pi".to_owned(),
            session_id: id.to_owned(),
        }
    }

    fn row(id: &str, updated_at: i64) -> SessionSummary {
        SessionSummary {
            session: session(id),
            title: None,
            cwd: None,
            created_at: None,
            updated_at,
            run_started_at: None,
            parent: None,
            model_id: None,
            status: SessionStatus::Idle,
            origin: SessionOrigin::Broski,
            source: None,
        }
    }

    #[test]
    fn a_pinned_session_no_list_holds_is_read_once_and_kept_current_by_the_catalog() {
        let mut kept = Kept::default();
        kept.set([session("a"), session("b")]);
        let wanted = kept.start_reads(|listed| listed == &session("b"));
        assert_eq!(wanted, [session("a")], "b is in a list already");
        assert_eq!(
            kept.start_reads(|_| false),
            [session("b")],
            "a is being read"
        );

        kept.read(&session("a"), Ok(Some(row("a", 10))));
        kept.updated(&row("a", 20));
        kept.updated(&row("z", 30));
        let rows: Vec<i64> = kept.rows().map(|row| row.updated_at).collect();
        assert_eq!(rows, [20], "only pinned sessions, as the catalog last said");

        kept.removed(&session("a"));
        assert_eq!(kept.rows().count(), 0);
        kept.forget_reads();
        assert!(
            kept.start_reads(|_| false).contains(&session("a")),
            "read again on a new socket"
        );

        kept.set([session("b")]);
        assert!(!kept.contains(&session("a")));
        assert!(kept.contains(&session("b")));
    }

    #[test]
    fn a_failed_read_is_read_again_and_a_missing_session_is_not() {
        let mut kept = Kept::default();
        kept.set([session("a"), session("b")]);
        let mut first = kept.start_reads(|_| false);
        first.sort_by(|x, y| x.session_id.cmp(&y.session_id));
        assert_eq!(first, [session("a"), session("b")]);
        kept.read(&session("a"), Err(()));
        kept.read(&session("b"), Ok(None));
        assert_eq!(kept.start_reads(|_| false), [session("a")]);
    }
}
