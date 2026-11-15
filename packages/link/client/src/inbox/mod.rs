//! The home screen: every session of every paired machine, by what it asks of the person.

mod seen;

use std::cmp::Reverse;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use broski_contract::{SessionRef, SessionStatus, SessionSummary, WorkingDirectory};
use broski_link_session::LinkRuntime;
use tokio::sync::Notify;
use tokio::time::Instant;

use self::seen::Seen;
pub use self::seen::SeenMarker;
use crate::machine::{InboxSource, Machine};
use crate::view::queue::BATCH_INTERVAL;
use crate::view::stream::LiveInfo;
use crate::wait;

/// What a session asks of the person; the inbox lists them in this order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum InboxState {
    /// An interaction waits for an answer.
    NeedsYou,
    /// A run, a compaction or a retry is under way.
    Working,
    /// Something happened since the person last saw it (a session never seen counts once idle).
    Done,
    Idle,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InboxRow {
    pub machine_id: String,
    pub machine_name: String,
    /// The session, and through it the backend.
    pub session: SessionRef,
    pub title: Option<String>,
    pub cwd: Option<WorkingDirectory>,
    pub state: InboxState,
    pub updated_at: i64,
    /// The title of the first pending interaction, known for a session a view is open on.
    pub ask: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InboxUpdate {
    /// Needs you, then working, then done, then idle; newest first within each.
    pub rows: Vec<InboxRow>,
    /// Every marker, when they changed since the last update: the app persists them and hands them
    /// back to `restore_seen` at its next start.
    pub seen: Option<Vec<SeenMarker>>,
}

struct Tracker {
    seen: Seen,
    delivered: Option<Vec<InboxRow>>,
    last_batch: Option<Instant>,
}

/// Every paired machine's sessions in one list. Machines join it as the phone starts or pairs them.
pub struct Inbox {
    runtime: LinkRuntime,
    notify: Arc<Notify>,
    machines: Mutex<Vec<Arc<Machine>>>,
    tracker: Mutex<Tracker>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Inbox {
    pub(crate) fn new(runtime: LinkRuntime) -> Inbox {
        Inbox {
            runtime,
            notify: Arc::new(Notify::new()),
            machines: Mutex::new(Vec::new()),
            tracker: Mutex::new(Tracker {
                seen: Seen::default(),
                delivered: None,
                last_batch: None,
            }),
        }
    }

    /// What a machine pokes when its rows or live state change.
    pub(crate) fn notify(&self) -> Arc<Notify> {
        Arc::clone(&self.notify)
    }

    pub(crate) fn add(&self, machine: Arc<Machine>) {
        let mut machines = locked(&self.machines);
        machines.retain(|known| known.id() != machine.id());
        machines.push(machine);
        self.notify.notify_one();
    }

    pub(crate) fn remove(&self, machine_id: &str) {
        locked(&self.machines).retain(|known| known.id() != machine_id);
        locked(&self.tracker).seen.forget_machine(machine_id);
        self.notify.notify_one();
    }

    /// The markers the app persisted, at its start.
    pub fn restore_seen(&self, markers: Vec<SeenMarker>) {
        locked(&self.tracker).seen.restore(markers);
        self.notify.notify_one();
    }

    pub fn seen(&self) -> Vec<SeenMarker> {
        locked(&self.tracker).seen.markers()
    }

    /// The person has seen the session as it is now: it is done no more until something happens.
    pub fn mark_seen(&self, machine_id: String, session: SessionRef) {
        let updated_at = self
            .sources()
            .into_iter()
            .filter(|(machine, _)| machine.id == machine_id)
            .flat_map(|(_, sources)| sources)
            .find(|source| source.row.session == session)
            .map(|source| source.row.updated_at);
        if let Some(updated_at) = updated_at {
            locked(&self.tracker)
                .seen
                .mark(&machine_id, &session, updated_at);
            self.notify.notify_one();
        }
    }

    pub fn rows(&self) -> Vec<InboxRow> {
        self.compute()
    }

    /// The rows each time they change, at most 30 times a second.
    pub async fn next_change(&self) -> InboxUpdate {
        loop {
            let rows = self.compute();
            let now = Instant::now();
            let wait = {
                let mut tracker = locked(&self.tracker);
                let changed = tracker.seen.changed || tracker.delivered.as_ref() != Some(&rows);
                match tracker.last_batch.map(|last| last + BATCH_INTERVAL) {
                    _ if !changed => None,
                    Some(next) if now < next => Some(next),
                    _ => {
                        tracker.last_batch = Some(now);
                        tracker.delivered = Some(rows.clone());
                        let seen = std::mem::take(&mut tracker.seen.changed)
                            .then(|| tracker.seen.markers());
                        return InboxUpdate { rows, seen };
                    }
                }
            };
            wait::notified(&self.runtime, &self.notify, wait).await;
        }
    }

    fn sources(&self) -> Vec<(MachineName, Vec<InboxSource>)> {
        locked(&self.machines)
            .iter()
            .map(|machine| {
                let state = machine.shared().lock();
                let (loaded, rows) = state.inbox_rows();
                let name = MachineName {
                    id: machine.id(),
                    name: state.record.name.clone(),
                    loaded,
                };
                (name, rows)
            })
            .collect()
    }

    fn compute(&self) -> Vec<InboxRow> {
        let sources = self.sources();
        let mut tracker = locked(&self.tracker);
        let mut rows: Vec<InboxRow> = Vec::new();
        for (machine, sources) in sources {
            if machine.loaded {
                tracker.seen.first_read(&machine.id, &sources);
            }
            for source in sources {
                let seen = tracker.seen.get(&machine.id, &source.row.session);
                rows.push(row(&machine, source, seen));
            }
        }
        rows.sort_by(|a, b| {
            let order = |row: &InboxRow| {
                let id = (row.machine_id.clone(), row.session.session_id.clone());
                (row.state, Reverse(row.updated_at), id)
            };
            order(a).cmp(&order(b))
        });
        rows
    }
}

struct MachineName {
    id: String,
    name: String,
    loaded: bool,
}

fn row(machine: &MachineName, source: InboxSource, seen: Option<i64>) -> InboxRow {
    let InboxSource { row, live } = source;
    InboxRow {
        state: state_of(&row, live.as_ref(), seen),
        ask: live.and_then(|live| live.ask),
        machine_id: machine.id.clone(),
        machine_name: machine.name.clone(),
        title: row.title.map(|title| title.text),
        session: row.session,
        cwd: row.cwd,
        updated_at: row.updated_at,
    }
}

/// A session a view is open on is read from its live state, which knows every pending
/// interaction; any other from its row, whose status says whether a blocking one waits.
fn state_of(row: &SessionSummary, live: Option<&LiveInfo>, seen: Option<i64>) -> InboxState {
    let needs_you = live.map_or(row.status == SessionStatus::WaitingForUser, |live| {
        live.needs_you
    });
    let working = live.map_or(row.status == SessionStatus::Running, |live| live.working);
    if needs_you {
        InboxState::NeedsYou
    } else if working {
        InboxState::Working
    } else if seen.is_none_or(|seen_at| row.updated_at > seen_at) {
        InboxState::Done
    } else {
        InboxState::Idle
    }
}
