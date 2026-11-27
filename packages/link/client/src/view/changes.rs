//! What one event did to a session's live state, as records a UI applies without the reducer.
//!
//! Each record replaces one field, or one entry of a list by its id, with the value the reducer
//! produced: the UI assigns, it never computes. Streaming text and tool progress are not records but
//! marks (`Delta::Block`, `Delta::Tool`): the queue turns a mark into the entry's newest value when it
//! hands the UI a batch, so a burst of deltas costs the UI one assignment.

use std::collections::HashSet;

use broski_contract::{
    apply_event, ActiveRun, ActivityItem, AgentEvent, BackendExtension, BackgroundTask, BlockId,
    CompactionState, ErrorEvent, Interaction, InteractionId, ModeSetting, ModelId, NoticeEvent,
    OpenBlock, QueueItem, RetryState, RunOutcome, RunningTool, SessionSnapshot, Timestamp,
    ToolCallId, TranscriptItem, Usage,
};

/// One change to the live state, or one moment the UI shows and the state does not hold. Applied
/// in order, a batch's records bring the UI's copy to the client's snapshot (`SessionUpdate`).
#[derive(Debug, Clone, PartialEq)]
pub enum SessionChange {
    /// `run` is replaced whole: a run started (its items empty), ended (`None`), or lost items to a
    /// retraction or a replacement.
    RunChanged {
        run: Option<ActiveRun>,
    },
    /// Appended to `run.items`.
    RunItemAppended {
        item: TranscriptItem,
    },
    /// Replaces `run.items[index]`, counted after the batch's earlier records.
    RunItemReplaced {
        index: u32,
        item: TranscriptItem,
    },
    /// The first `count` of `run.items` leave, and `run.droppedItems` becomes `dropped_items`.
    RunItemsDropped {
        count: u32,
        dropped_items: i64,
    },
    /// Appended to `blocks`.
    BlockOpened {
        block: OpenBlock,
    },
    /// The text of the open block `block_id` is now `text`.
    BlockTextChanged {
        block_id: BlockId,
        text: String,
    },
    /// The open block `block_id` leaves `blocks`.
    BlockClosed {
        block_id: BlockId,
    },
    /// Appended to `tools`.
    ToolOpened {
        tool: RunningTool,
    },
    /// Replaces the running tool with the same `toolCallId`.
    ToolChanged {
        tool: RunningTool,
    },
    /// The running tool `tool_call_id` leaves `tools`.
    ToolClosed {
        tool_call_id: ToolCallId,
    },
    /// Appended to `interactions`.
    InteractionAdded {
        interaction: Interaction,
    },
    /// The interaction `interaction_id` leaves `interactions`.
    InteractionRemoved {
        interaction_id: InteractionId,
    },
    QueueChanged {
        items: Vec<QueueItem>,
    },
    BackgroundTasksChanged {
        tasks: Vec<BackgroundTask>,
    },
    ModelChanged {
        model_id: Option<ModelId>,
        thinking: Option<String>,
    },
    ModesChanged {
        modes: Vec<ModeSetting>,
    },
    UsageChanged {
        usage: Option<Usage>,
    },
    CompactionChanged {
        compaction: Option<CompactionState>,
    },
    RetryChanged {
        retry: Option<RetryState>,
    },
    OutcomeChanged {
        outcome: Option<RunOutcome>,
    },
    NoticeShown {
        notice: NoticeEvent,
    },
    /// An activity outside any run, which no run item holds: the UI shows it after the transcript
    /// until a read of the transcript's newest page brings it in.
    ActivityShown {
        item: ActivityItem,
    },
    ErrorShown {
        error: ErrorEvent,
    },
    ExtensionReceived {
        extension: BackendExtension,
    },
    /// Input the backend handed back (queued input a stop took back, or a prompt it lost before
    /// its agent stored it): the UI puts it where the person types,
    /// joined by blank lines, in front of what is there (contract README §10).
    InputReturned {
        texts: Vec<String>,
    },
}

/// What applying one event asks of each subscriber's queue.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Delta {
    Change(SessionChange),
    /// The open block's text changed.
    Block(BlockId),
    /// The running tool changed.
    Tool(ToolCallId),
    /// The whole state was replaced.
    Reset,
}

/// Applies `event` to `snapshot` with the contract's reducer and says what it changed.
pub(crate) fn apply(
    snapshot: &mut SessionSnapshot,
    at: Timestamp,
    event: AgentEvent,
) -> Vec<Delta> {
    let kind = Kind::of(&event, at);
    let before = Before::of(snapshot, &kind);
    apply_event(snapshot, at, event);
    kind.deltas(&before, snapshot)
}

/// The event, as far as the deltas need it once the reducer has taken it.
enum Kind {
    RunStarted,
    RunFinished,
    Item,
    Activity(ActivityItem),
    BlockStarted,
    BlockDelta(BlockId),
    BlockFinished(BlockId),
    ToolStarted,
    ToolUpdated(ToolCallId),
    ToolFinished(ToolCallId),
    InteractionRequested,
    InteractionResolved(InteractionId),
    Field(fn(&SessionSnapshot) -> SessionChange),
    Retracted,
    Moment(SessionChange),
    Replaced,
    Resynced,
}

impl Kind {
    fn of(event: &AgentEvent, at: Timestamp) -> Kind {
        match event {
            AgentEvent::RunStarted(_) => Kind::RunStarted,
            AgentEvent::RunFinished(_) => Kind::RunFinished,
            AgentEvent::UserMessage(_) => Kind::Item,
            AgentEvent::BlockStarted(_) => Kind::BlockStarted,
            AgentEvent::BlockDelta(delta) => Kind::BlockDelta(delta.block_id.clone()),
            AgentEvent::BlockFinished(finished) => Kind::BlockFinished(finished.block_id.clone()),
            AgentEvent::ToolStarted(_) => Kind::ToolStarted,
            AgentEvent::ToolUpdated(updated) => Kind::ToolUpdated(updated.tool_call_id.clone()),
            AgentEvent::ToolFinished(finished) => Kind::ToolFinished(finished.tool_call_id.clone()),
            AgentEvent::InteractionRequested(_) => Kind::InteractionRequested,
            AgentEvent::InteractionResolved(resolved) => {
                Kind::InteractionResolved(resolved.interaction_id.clone())
            }
            AgentEvent::QueueChanged(_) => Kind::Field(queue),
            AgentEvent::BackgroundTasksChanged(_) => Kind::Field(background_tasks),
            AgentEvent::Activity(activity) => Kind::Activity(ActivityItem {
                id: activity.activity_id.clone(),
                at: Some(at),
                activity: activity.activity.clone(),
            }),
            AgentEvent::CompactionStarted(_) | AgentEvent::CompactionFinished(_) => {
                Kind::Field(compaction)
            }
            AgentEvent::RetryScheduled(_) | AgentEvent::RetryFinished(_) => Kind::Field(retry),
            AgentEvent::UsageUpdated(_) => Kind::Field(usage),
            AgentEvent::ModelChanged(_) => Kind::Field(model),
            AgentEvent::ModeChanged(_) => Kind::Field(modes),
            AgentEvent::MessagesRetracted(_) => Kind::Retracted,
            AgentEvent::SessionReplaced(_) => Kind::Replaced,
            AgentEvent::Resynced(_) => Kind::Resynced,
            AgentEvent::InputReturned(returned) => Kind::Moment(SessionChange::InputReturned {
                texts: returned.texts.clone(),
            }),
            AgentEvent::Notice(notice) => Kind::Moment(SessionChange::NoticeShown {
                notice: notice.clone(),
            }),
            AgentEvent::Error(error) => Kind::Moment(SessionChange::ErrorShown {
                error: error.clone(),
            }),
            AgentEvent::Extension(extension) => Kind::Moment(SessionChange::ExtensionReceived {
                extension: extension.extension.clone(),
            }),
        }
    }

    fn deltas(self, before: &Before, after: &SessionSnapshot) -> Vec<Delta> {
        let items = |finished: Option<&ToolCallId>| run_items(before, after, finished);
        match self {
            Kind::RunStarted => changes([run(after)]),
            Kind::RunFinished => changes([run(after), retry(after), outcome(after)]),
            Kind::Item => changes(items(None)),
            Kind::Activity(item) => match after.run {
                Some(_) => changes(items(None)),
                None => changes([SessionChange::ActivityShown { item }]),
            },
            Kind::BlockStarted => {
                changes(after.blocks.last().map(|block| SessionChange::BlockOpened {
                    block: block.clone(),
                }))
            }
            Kind::BlockDelta(block_id) => vec![Delta::Block(block_id)],
            Kind::BlockFinished(block_id) => changes(
                [SessionChange::BlockClosed { block_id }]
                    .into_iter()
                    .chain(items(None)),
            ),
            Kind::ToolStarted => changes(
                after
                    .tools
                    .last()
                    .map(|tool| SessionChange::ToolOpened { tool: tool.clone() })
                    .into_iter()
                    .chain(items(None)),
            ),
            Kind::ToolUpdated(tool_call_id) => vec![Delta::Tool(tool_call_id)],
            Kind::ToolFinished(tool_call_id) => {
                let finished = items(Some(&tool_call_id));
                changes(
                    [SessionChange::ToolClosed { tool_call_id }]
                        .into_iter()
                        .chain(finished),
                )
            }
            Kind::InteractionRequested => changes(after.interactions.last().map(|interaction| {
                SessionChange::InteractionAdded {
                    interaction: interaction.clone(),
                }
            })),
            Kind::InteractionResolved(interaction_id) => {
                changes([SessionChange::InteractionRemoved { interaction_id }])
            }
            Kind::Field(field) => changes([field(after)]),
            Kind::Retracted => changes(retracted(before, after)),
            Kind::Moment(moment) => changes([moment]),
            Kind::Replaced => changes(after.run.is_some().then(|| run(after))),
            Kind::Resynced => vec![Delta::Reset],
        }
    }
}

/// What the deltas need from the state before the event; the ids only for a retraction.
struct Before {
    run: Option<(usize, i64)>,
    blocks: Vec<BlockId>,
    tools: Vec<ToolCallId>,
}

impl Before {
    fn of(snapshot: &SessionSnapshot, kind: &Kind) -> Before {
        let run = snapshot
            .run
            .as_ref()
            .map(|run| (run.items.len(), run.dropped_items));
        if !matches!(kind, Kind::Retracted) {
            return Before {
                run,
                blocks: Vec::new(),
                tools: Vec::new(),
            };
        }
        Before {
            run,
            blocks: snapshot
                .blocks
                .iter()
                .map(|block| block.block_id.clone())
                .collect(),
            tools: snapshot
                .tools
                .iter()
                .map(|tool| tool.tool_call_id.clone())
                .collect(),
        }
    }
}

fn changes(records: impl IntoIterator<Item = SessionChange>) -> Vec<Delta> {
    records.into_iter().map(Delta::Change).collect()
}

fn run(after: &SessionSnapshot) -> SessionChange {
    SessionChange::RunChanged {
        run: after.run.clone(),
    }
}

fn retry(after: &SessionSnapshot) -> SessionChange {
    SessionChange::RetryChanged {
        retry: after.retry.clone(),
    }
}

fn outcome(after: &SessionSnapshot) -> SessionChange {
    SessionChange::OutcomeChanged {
        outcome: after.last_outcome.clone(),
    }
}

fn queue(after: &SessionSnapshot) -> SessionChange {
    SessionChange::QueueChanged {
        items: after.queue.clone(),
    }
}

fn background_tasks(after: &SessionSnapshot) -> SessionChange {
    SessionChange::BackgroundTasksChanged {
        tasks: after.background_tasks.clone(),
    }
}

fn compaction(after: &SessionSnapshot) -> SessionChange {
    SessionChange::CompactionChanged {
        compaction: after.compaction.clone(),
    }
}

fn usage(after: &SessionSnapshot) -> SessionChange {
    SessionChange::UsageChanged {
        usage: after.usage.clone(),
    }
}

fn model(after: &SessionSnapshot) -> SessionChange {
    SessionChange::ModelChanged {
        model_id: after.model_id.clone(),
        thinking: after.thinking.clone(),
    }
}

fn modes(after: &SessionSnapshot) -> SessionChange {
    SessionChange::ModesChanged {
        modes: after.modes.clone(),
    }
}

/// The item the event appended, the oldest the bound then pushed out (the reducer appends first),
/// and, for a finished tool, its call item completed in place. Nothing outside a run.
fn run_items(
    before: &Before,
    after: &SessionSnapshot,
    finished: Option<&ToolCallId>,
) -> Vec<SessionChange> {
    let (Some((length, dropped)), Some(run)) = (before.run, after.run.as_ref()) else {
        return Vec::new();
    };
    let newly_dropped = (run.dropped_items - dropped) as usize;
    let appended = run.items.len() + newly_dropped - length;
    let mut records: Vec<SessionChange> = run.items[run.items.len() - appended..]
        .iter()
        .map(|item| SessionChange::RunItemAppended { item: item.clone() })
        .collect();
    if newly_dropped > 0 {
        records.push(SessionChange::RunItemsDropped {
            count: newly_dropped as u32,
            dropped_items: run.dropped_items,
        });
    }
    let completed = run.items.iter().enumerate().filter(|(_, item)| {
        matches!(item, TranscriptItem::ToolCall(call) if Some(&call.tool_call_id) == finished)
    });
    records.extend(
        completed.map(|(index, item)| SessionChange::RunItemReplaced {
            index: index as u32,
            item: item.clone(),
        }),
    );
    records
}

/// A retraction only removes: the open blocks and running tools of the retracted messages close,
/// and the run, which lost their items wherever they were, is replaced whole.
fn retracted(before: &Before, after: &SessionSnapshot) -> Vec<SessionChange> {
    let blocks: HashSet<&BlockId> = after.blocks.iter().map(|block| &block.block_id).collect();
    let tools: HashSet<&ToolCallId> = after.tools.iter().map(|tool| &tool.tool_call_id).collect();
    let closed_blocks = before
        .blocks
        .iter()
        .filter(|id| !blocks.contains(id))
        .map(|block_id| SessionChange::BlockClosed {
            block_id: block_id.clone(),
        });
    let closed_tools = before
        .tools
        .iter()
        .filter(|id| !tools.contains(id))
        .map(|tool_call_id| SessionChange::ToolClosed {
            tool_call_id: tool_call_id.clone(),
        });
    let run = after.run.is_some().then(|| run(after));
    closed_blocks.chain(closed_tools).chain(run).collect()
}
