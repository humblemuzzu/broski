//! The UI's side of a session view, as a Swift or Kotlin model does it: assign what each update
//! carries, never reduce. Tests hold its state equal to the view's snapshot; the unit tests include
//! this file too.

use broski_client::{SessionChange, SessionUpdate, ViewEnd};
use broski_contract::{empty_snapshot, ActiveRun, SessionRef, SessionSnapshot, SessionStatus};

pub struct Replica {
    pub session: Option<SessionRef>,
    pub snapshot: SessionSnapshot,
    pub status: Option<SessionStatus>,
    /// Notices, errors, extensions and returned input, in order.
    pub moments: Vec<SessionChange>,
    pub ended: Option<ViewEnd>,
    pub resets: usize,
    pub batches: usize,
}

impl Default for Replica {
    fn default() -> Replica {
        Replica {
            session: None,
            snapshot: empty_snapshot(),
            status: None,
            moments: Vec::new(),
            ended: None,
            resets: 0,
            batches: 0,
        }
    }
}

impl Replica {
    pub fn apply(&mut self, update: SessionUpdate) {
        match update {
            SessionUpdate::Reset {
                session,
                snapshot,
                status,
                ..
            } => {
                self.session = Some(session);
                self.snapshot = snapshot;
                self.status = Some(status);
                self.resets += 1;
            }
            SessionUpdate::Changes { changes, status } => {
                for change in changes {
                    self.change(change);
                }
                self.status = Some(status);
                self.batches += 1;
            }
            SessionUpdate::Ended { reason } => self.ended = Some(reason),
        }
    }

    fn run(&mut self) -> &mut ActiveRun {
        self.snapshot
            .run
            .as_mut()
            .expect("a change to the run's items arrives while there is a run")
    }

    fn change(&mut self, change: SessionChange) {
        let state = &mut self.snapshot;
        match change {
            SessionChange::RunChanged { run } => state.run = run,
            SessionChange::RunItemAppended { item } => self.run().items.push(item),
            SessionChange::RunItemReplaced { index, item } => {
                self.run().items[index as usize] = item
            }
            SessionChange::RunItemsDropped {
                count,
                dropped_items,
            } => {
                let run = self.run();
                run.items.drain(..count as usize);
                run.dropped_items = dropped_items;
            }
            SessionChange::BlockOpened { block } => state.blocks.push(block),
            SessionChange::BlockTextChanged { block_id, text } => state
                .blocks
                .iter_mut()
                .filter(|block| block.block_id == block_id)
                .for_each(|block| block.text.clone_from(&text)),
            SessionChange::BlockClosed { block_id } => {
                state.blocks.retain(|block| block.block_id != block_id);
            }
            SessionChange::ToolOpened { tool } => state.tools.push(tool),
            SessionChange::ToolChanged { tool } => state
                .tools
                .iter_mut()
                .filter(|running| running.tool_call_id == tool.tool_call_id)
                .for_each(|running| running.clone_from(&tool)),
            SessionChange::ToolClosed { tool_call_id } => {
                state.tools.retain(|tool| tool.tool_call_id != tool_call_id);
            }
            SessionChange::InteractionAdded { interaction } => state.interactions.push(interaction),
            SessionChange::InteractionRemoved { interaction_id } => {
                state.interactions.retain(|ask| ask.id != interaction_id);
            }
            SessionChange::QueueChanged { items } => state.queue = items,
            SessionChange::ModelChanged { model_id, thinking } => {
                state.model_id = model_id;
                state.thinking = thinking;
            }
            SessionChange::ModesChanged { modes } => state.modes = modes,
            SessionChange::UsageChanged { usage } => state.usage = usage,
            SessionChange::CompactionChanged { compaction } => state.compaction = compaction,
            SessionChange::RetryChanged { retry } => state.retry = retry,
            SessionChange::OutcomeChanged { outcome } => state.last_outcome = outcome,
            moment @ (SessionChange::NoticeShown { .. }
            | SessionChange::ErrorShown { .. }
            | SessionChange::ExtensionReceived { .. }
            | SessionChange::InputReturned { .. }) => self.moments.push(moment),
        }
    }
}
