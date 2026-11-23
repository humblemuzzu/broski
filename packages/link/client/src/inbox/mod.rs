//! The home screen: every session of every paired machine, by what it asks of the person.

mod answer;
mod cache;
mod compute;
mod feed;
mod pending;
mod rows;
mod seen;

use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::Duration;

use broski_contract::{SessionRef, WorkingDirectory};
use broski_link_session::LinkRuntime;
use serde::{Deserialize, Serialize};
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tokio::time::Instant;

pub use self::answer::AnswerOutcome;
use self::cache::{Cache, CacheDue};
use self::compute::Computed;
pub use self::feed::KeptSession;
pub use self::pending::PendingAsk;
pub(crate) use self::pending::{ask_command, pending_ask};
use self::rows::is_settled;
use self::seen::Seen;
pub use self::seen::{MachineHistory, SeenMarker, SeenState, UnreadSession};
use crate::error::ClientError;
use crate::machine::Machine;
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
    /// When the active run or compaction started, when the session is `NeedsYou` or `Working`.
    pub run_started_at: Option<i64>,
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
    /// Older sessions are still to load: `load_more` reads the next page as the person nears the end.
    pub has_more: bool,
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
    delivered: Option<Computed>,
    last_batch: Option<Instant>,
    /// What the inbox searches for, given to every machine that joins.
    search: Option<String>,
    /// The pinned sessions, each machine's given to it as it joins.
    kept: Vec<KeptSession>,
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
                search: None,
                kept: Vec::new(),
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
        machines.push(Arc::clone(&machine));
        drop(machines);
        let mut tracker = locked(&self.tracker);
        tracker.joined = true;
        let search = tracker.search.clone();
        let kept = feed::kept_on(&tracker.kept, &machine.id());
        drop(tracker);
        machine.shared().set_search(search);
        machine.shared().set_kept(kept);
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

    /// The person has seen the session as it is now: it is done no more until something happens,
    /// and no longer marked unread.
    ///
    /// A cached row, shown while its machine's lists load, is marked at its `updatedAt`. A session
    /// not listed yet, or whose row has not caught up with what the person's own view saw, is
    /// marked when its row settles.
    pub fn mark_seen(&self, machine_id: String, session: SessionRef) {
        let listed = (self.sources().into_iter()).find(|(machine, _)| machine.id == machine_id);
        let loaded = listed.as_ref().is_some_and(|(machine, _)| machine.loaded);
        let source = (listed.into_iter().flat_map(|(_, feed)| feed.sources))
            .find(|source| source.row.session == session);
        let mut tracker = locked(&self.tracker);
        let cached = (!loaded).then(|| tracker.cache.settled_at(&machine_id, &session));
        match cached.flatten() {
            Some(updated_at) => tracker.seen.see_cached(&machine_id, &session, updated_at),
            None => tracker.seen.see(&machine_id, &session, source.as_ref()),
        }
        drop(tracker);
        self.wake.notify_one();
    }

    /// The person wants the session shown as `Done`, however old, until they next see it. A session
    /// that is working or needs them shows that first, and is `Done` once it settles.
    pub fn mark_unread(&self, machine_id: String, session: SessionRef) {
        locked(&self.tracker).seen.unsee(&machine_id, &session);
        self.wake.notify_one();
    }

    /// Marks every settled session in the inbox as seen at its current `updatedAt`, leaving
    /// working and waiting sessions untouched so their completion is still reported.
    pub fn mark_all_seen(&self) {
        let feeds = self.sources();
        let mut tracker = locked(&self.tracker);
        for (machine, feed) in &feeds {
            if !machine.loaded {
                let cached: Vec<_> = tracker
                    .cache
                    .rows_of(&machine.id)
                    .iter()
                    .filter(|row| matches!(row.state, InboxState::Done | InboxState::Idle))
                    .map(|row| (row.session.clone(), row.updated_at))
                    .collect();
                for (session, updated_at) in cached {
                    tracker.seen.mark_at(&machine.id, &session, updated_at);
                }
                continue;
            }
            for source in &feed.sources {
                if is_settled(&source.row, source.live.as_ref()) {
                    tracker
                        .seen
                        .mark_at(&machine.id, &source.row.session, source.row.updated_at);
                }
            }
        }
        let changed = tracker.seen.changed;
        drop(tracker);
        if changed {
            self.wake.notify_one();
        }
    }

    pub fn rows(&self) -> Vec<InboxRow> {
        self.compute().rows
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
            let computed = self.compute();
            let now = Instant::now();
            let now_ms = rows::wall_ms();
            let settles = rows::next_settle_ms(&computed.rows, now_ms)
                .map(|at| now + Duration::from_millis(at.saturating_sub(now_ms) as u64));
            let wait = {
                let mut tracker = locked(&self.tracker);
                let due = match tracker.joined {
                    true => tracker.cache.check(&computed.rows, now),
                    false => CacheDue::Unchanged,
                };
                let changed = tracker.seen.changed
                    || tracker.delivered.as_ref() != Some(&computed)
                    || matches!(due, CacheDue::Now(_));
                match tracker.last_batch.map(|last| last + BATCH_INTERVAL) {
                    _ if !changed => match due {
                        CacheDue::At(at) => Some(at),
                        _ => None,
                    },
                    Some(next) if now < next => Some(next),
                    _ => return tracker.deliver(computed, due, now),
                }
            };
            let wait = wait.into_iter().chain(settles).min();
            wait::notified(&self.runtime, &self.changed, wait).await;
        }
    }
}

impl Tracker {
    fn deliver(&mut self, computed: Computed, due: CacheDue, now: Instant) -> InboxUpdate {
        self.last_batch = Some(now);
        self.delivered = Some(computed.clone());
        let seen = std::mem::take(&mut self.seen.changed).then(|| self.seen.state());
        let cache = match due {
            CacheDue::Now(kept) => Some(self.cache.emit(kept, now)),
            _ => None,
        };
        InboxUpdate {
            rows: computed.rows,
            has_more: computed.has_more,
            seen,
            cache,
        }
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
