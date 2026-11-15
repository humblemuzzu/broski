//! One subscriber's updates: the records not handed over yet, the marks of streaming entries, and
//! the pace they are handed over at.

use std::sync::Arc;
use std::time::Duration;

use broski_contract::{
    session_status, BlockId, SessionCapabilities, SessionRef, SessionSnapshot, ToolCallId,
    MAX_LIST_ITEMS,
};
use tokio::sync::Notify;
use tokio::time::Instant;

use super::changes::{Delta, SessionChange};
use super::{SessionUpdate, ViewEnd};

/// The shortest gap between two batches: at most 30 a second, the most a screen shows.
pub(crate) const BATCH_INTERVAL: Duration = Duration::from_millis(33);

/// Records a subscriber may leave untaken; past them the next update is the whole snapshot, which
/// costs no more than the records it replaces.
pub(crate) const MAX_QUEUED_CHANGES: usize = MAX_LIST_ITEMS;

#[derive(Debug, Clone, PartialEq)]
enum Mark {
    Block(BlockId),
    Tool(ToolCallId),
}

/// The stream's state a batch is read from.
pub(crate) struct Live<'a> {
    pub(crate) session: &'a SessionRef,
    pub(crate) capabilities: &'a SessionCapabilities,
    pub(crate) snapshot: &'a SessionSnapshot,
}

pub(crate) enum Take {
    Update(SessionUpdate),
    /// Nothing to hand over yet: wait for the notify, or until the instant when there is one.
    Wait(Option<Instant>),
    Finished,
}

pub(crate) struct UpdateQueue {
    pub(crate) notify: Arc<Notify>,
    reset: bool,
    changes: Vec<SessionChange>,
    /// Applied after every record of the batch, with the entry's value at that moment.
    marks: Vec<Mark>,
    ended: Option<ViewEnd>,
    finished: bool,
    last_batch: Option<Instant>,
}

impl UpdateQueue {
    /// A new subscriber starts from the whole snapshot.
    pub(crate) fn new() -> UpdateQueue {
        UpdateQueue {
            notify: Arc::new(Notify::new()),
            reset: true,
            changes: Vec::new(),
            marks: Vec::new(),
            ended: None,
            finished: false,
            last_batch: None,
        }
    }

    pub(crate) fn push(&mut self, delta: Delta) {
        match delta {
            Delta::Reset => self.reset(),
            _ if self.reset || self.ended.is_some() => {}
            Delta::Change(change) => {
                self.changes.push(change);
                if self.changes.len() > MAX_QUEUED_CHANGES {
                    self.reset();
                }
            }
            Delta::Block(block_id) => self.mark(Mark::Block(block_id)),
            Delta::Tool(tool_call_id) => self.mark(Mark::Tool(tool_call_id)),
        }
        self.notify.notify_one();
    }

    pub(crate) fn reset(&mut self) {
        self.reset = true;
        self.changes.clear();
        self.marks.clear();
        self.notify.notify_one();
    }

    pub(crate) fn end(&mut self, reason: ViewEnd) {
        if self.ended.is_none() && !self.finished {
            self.ended = Some(reason);
        }
        self.notify.notify_one();
    }

    fn mark(&mut self, mark: Mark) {
        if !self.marks.contains(&mark) {
            self.marks.push(mark);
        }
    }

    /// The next update, once `live` exists (the stream has been attached once).
    pub(crate) fn take(&mut self, now: Instant, live: Option<Live<'_>>) -> Take {
        if self.finished {
            return Take::Finished;
        }
        if let Some(reason) = self.ended.take() {
            self.finished = true;
            return Take::Update(SessionUpdate::Ended { reason });
        }
        let Some(live) = live else {
            return Take::Wait(None);
        };
        if self.reset {
            return Take::Update(self.whole(now, &live));
        }
        if self.changes.is_empty() && self.marks.is_empty() {
            return Take::Wait(None);
        }
        match self.last_batch.map(|last| last + BATCH_INTERVAL) {
            Some(next) if now < next => Take::Wait(Some(next)),
            _ => Take::Update(self.batch(now, live.snapshot)),
        }
    }

    fn whole(&mut self, now: Instant, live: &Live<'_>) -> SessionUpdate {
        self.reset = false;
        self.last_batch = Some(now);
        SessionUpdate::Reset {
            session: live.session.clone(),
            capabilities: live.capabilities.clone(),
            snapshot: live.snapshot.clone(),
            status: session_status(live.snapshot),
        }
    }

    fn batch(&mut self, now: Instant, snapshot: &SessionSnapshot) -> SessionUpdate {
        self.last_batch = Some(now);
        let mut changes = std::mem::take(&mut self.changes);
        changes.extend(
            self.marks
                .drain(..)
                .filter_map(|mark| newest(mark, snapshot)),
        );
        SessionUpdate::Changes {
            changes,
            status: session_status(snapshot),
        }
    }
}

/// A marked entry as it is now; nothing when it has closed since, which a record in the same batch
/// or an earlier one says.
fn newest(mark: Mark, snapshot: &SessionSnapshot) -> Option<SessionChange> {
    match mark {
        Mark::Block(block_id) => snapshot
            .blocks
            .iter()
            .find(|block| block.block_id == block_id)
            .map(|block| SessionChange::BlockTextChanged {
                text: block.text.clone(),
                block_id,
            }),
        Mark::Tool(tool_call_id) => snapshot
            .tools
            .iter()
            .find(|tool| tool.tool_call_id == tool_call_id)
            .map(|tool| SessionChange::ToolChanged { tool: tool.clone() }),
    }
}
