//! The home screen: every session of every paired machine, by what it asks of the person.

mod answer;
mod cache;
mod pending;
mod rows;
mod seen;

use std::cmp::Reverse;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};

use broski_contract::{SessionRef, WorkingDirectory};
use broski_link_session::LinkRuntime;
use serde::{Deserialize, Serialize};
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tokio::time::Instant;

pub use self::answer::AnswerOutcome;
use self::cache::{Cache, CacheDue};
pub use self::pending::PendingAsk;
pub(crate) use self::pending::{ask_command, pending_ask};
use self::rows::{cached_row, live_row, MachineName};
use self::seen::Seen;
pub use self::seen::{SeenMarker, SeenState};
use crate::error::ClientError;
use crate::machine::{InboxSource, Machine};
use crate::view::queue::BATCH_INTERVAL;
use crate::wait;

/// What a session asks of the person; the inbox lists them in this order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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
    /// The title of the first pending interaction: live for a session the inbox views, as last
    /// known for a row from the cache.
    pub ask: Option<String>,
    /// The command that ask would run, exactly as the agent wrote it, when it is a tool permission
    /// for one: "Claude Code wants to run `npm test`".
    pub command: Option<String>,
    /// What can be answered from the row, while the inbox views the session live.
    pub pending: Option<PendingAsk>,
    /// The row is the last known one, from the restored cache: the machine's lists have not loaded
    /// since the app started. It never has `pending`.
    pub cached: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InboxUpdate {
    /// Needs you, then working, then done, then idle; newest first within each.
    pub rows: Vec<InboxRow>,
    /// What the person has seen, when it changed since the last update: the app persists it and hands
    /// it back to `restore_seen` at its next start.
    pub seen: Option<SeenState>,
    /// The inbox as it stands, when it changed, at most every 2 s: the app persists it and hands it
    /// back to `restore_cache` at its next start. An update may carry only this.
    pub cache: Option<Vec<u8>>,
}

struct Tracker {
    seen: Seen,
    cache: Cache,
    /// A machine has joined since the phone opened: before that the rows are empty only because
    /// nothing started yet, and a cache of them would overwrite the app's stored one.
    joined: bool,
    delivered: Option<Vec<InboxRow>>,
    last_batch: Option<Instant>,
}

/// Every paired machine's sessions in one list. Machines join it as the phone starts or pairs them.
pub struct Inbox {
    runtime: LinkRuntime,
    /// What the machines and the inbox itself poke when rows or seen state may have changed; the
    /// settling task is its one reader.
    wake: Arc<Notify>,
    /// What the settling task pokes once it has looked; `next_change` is its one reader.
    changed: Notify,
    machines: Mutex<Vec<Arc<Machine>>>,
    tracker: Mutex<Tracker>,
    settling: JoinHandle<()>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Marks a machine's history seen as soon as its rows are in, whether or not the UI is reading the
/// inbox: a session that finishes before the first read must still show as done.
async fn settle_on_wake(inbox: Weak<Inbox>, wake: Arc<Notify>) {
    loop {
        wake.notified().await;
        let Some(inbox) = inbox.upgrade() else {
            return;
        };
        inbox.settle();
        inbox.changed.notify_one();
    }
}

impl Inbox {
    pub(crate) fn new(runtime: LinkRuntime) -> Arc<Inbox> {
        let wake = Arc::new(Notify::new());
        Arc::new_cyclic(|inbox| Inbox {
            settling: runtime
                .handle()
                .spawn(settle_on_wake(inbox.clone(), Arc::clone(&wake))),
            runtime,
            wake,
            changed: Notify::new(),
            machines: Mutex::new(Vec::new()),
            tracker: Mutex::new(Tracker {
                seen: Seen::default(),
                cache: Cache::default(),
                joined: false,
                delivered: None,
                last_batch: None,
            }),
        })
    }

    /// What a machine pokes when its rows or live state change.
    pub(crate) fn notify(&self) -> Arc<Notify> {
        Arc::clone(&self.wake)
    }

    pub(crate) fn add(&self, machine: Arc<Machine>) {
        let mut machines = locked(&self.machines);
        machines.retain(|known| known.id() != machine.id());
        machines.push(machine);
        drop(machines);
        locked(&self.tracker).joined = true;
        self.wake.notify_one();
    }

    pub(crate) fn remove(&self, machine_id: &str) {
        locked(&self.machines).retain(|known| known.id() != machine_id);
        let mut tracker = locked(&self.tracker);
        tracker.seen.forget_machine(machine_id);
        tracker.cache.drop_machine(machine_id);
        drop(tracker);
        self.wake.notify_one();
    }

    fn machine(&self, machine_id: &str) -> Option<Arc<Machine>> {
        locked(&self.machines)
            .iter()
            .find(|machine| machine.id() == machine_id)
            .cloned()
    }

    /// What the app persisted, at its start and before it starts any machine.
    pub fn restore_seen(&self, state: SeenState) {
        locked(&self.tracker).seen.restore(state);
        self.wake.notify_one();
    }

    /// The last `InboxUpdate.cache` the app persisted, at its start and before it starts any
    /// machine. Each machine's cached rows show until its lists load; they are dropped when it is
    /// forgotten. Bytes that are not a cache of this version are refused, and change nothing.
    pub fn restore_cache(&self, cache: Vec<u8>) -> Result<(), ClientError> {
        locked(&self.tracker).cache.restore(&cache)?;
        self.wake.notify_one();
        Ok(())
    }

    pub fn seen(&self) -> SeenState {
        locked(&self.tracker).seen.state()
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
            self.wake.notify_one();
        }
    }

    pub fn rows(&self) -> Vec<InboxRow> {
        self.compute()
    }

    /// Pull to refresh: every machine whose bridge is ready reloads its sessions from the first
    /// page, and every machine waiting to dial dials now. Returns once the reloads are answered.
    pub async fn refresh(&self) {
        let machines = locked(&self.machines).clone();
        let reloads: Vec<_> = machines
            .iter()
            .flat_map(|machine| machine.shared().reload_inbox())
            .collect();
        for reload in reloads {
            let _ = reload.await;
        }
    }

    /// The rows each time they change, at most 30 times a second, with the seen state and the
    /// cache when they changed.
    pub async fn next_change(&self) -> InboxUpdate {
        loop {
            let rows = self.compute();
            let now = Instant::now();
            let wait = {
                let mut tracker = locked(&self.tracker);
                let due = match tracker.joined {
                    true => tracker.cache.check(&rows, now),
                    false => CacheDue::Unchanged,
                };
                let changed = tracker.seen.changed
                    || tracker.delivered.as_ref() != Some(&rows)
                    || matches!(due, CacheDue::Now(_));
                match tracker.last_batch.map(|last| last + BATCH_INTERVAL) {
                    _ if !changed => match due {
                        CacheDue::At(at) => Some(at),
                        _ => None,
                    },
                    Some(next) if now < next => Some(next),
                    _ => return tracker.deliver(rows, due, now),
                }
            };
            wait::notified(&self.runtime, &self.changed, wait).await;
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

    /// The sources, after the history of every machine whose rows are all in for the first time
    /// has been marked seen, and its cached rows let go.
    fn settle(&self) -> Vec<(MachineName, Vec<InboxSource>)> {
        let sources = self.sources();
        let mut tracker = locked(&self.tracker);
        for (machine, rows) in &sources {
            if machine.loaded {
                tracker.seen.first_read(&machine.id, rows);
                tracker.cache.drop_machine(&machine.id);
            }
        }
        drop(tracker);
        sources
    }

    /// A machine whose lists have not loaded shows its cached rows, when the app restored any.
    fn compute(&self) -> Vec<InboxRow> {
        let sources = self.settle();
        let tracker = locked(&self.tracker);
        let mut rows: Vec<InboxRow> = Vec::new();
        for (machine, sources) in sources {
            let cached = tracker.cache.rows_of(&machine.id);
            if !machine.loaded && !cached.is_empty() {
                for row in cached {
                    let seen = tracker.seen.get(&machine.id, &row.session);
                    rows.push(cached_row(row, seen));
                }
                continue;
            }
            for source in sources {
                let seen = tracker.seen.get(&machine.id, &source.row.session);
                rows.push(live_row(&machine, source, seen));
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

impl Tracker {
    fn deliver(&mut self, rows: Vec<InboxRow>, due: CacheDue, now: Instant) -> InboxUpdate {
        self.last_batch = Some(now);
        self.delivered = Some(rows.clone());
        let seen = std::mem::take(&mut self.seen.changed).then(|| self.seen.state());
        let cache = match due {
            CacheDue::Now(kept) => Some(self.cache.emit(kept, now)),
            _ => None,
        };
        InboxUpdate { rows, seen, cache }
    }
}

impl Drop for Inbox {
    fn drop(&mut self) {
        self.settling.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn no_cache_is_handed_out_before_a_machine_joins() {
        let inbox = Inbox::new(LinkRuntime::new().expect("a runtime"));
        let first = inbox.next_change().await;
        assert!(first.rows.is_empty());
        assert_eq!(
            first.cache, None,
            "an empty inbox would overwrite the stored one"
        );
    }
}
