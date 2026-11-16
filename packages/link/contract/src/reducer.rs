//! The live state of a session and the meaning of every event (`session-reducer.ts`). The bridge's
//! `reducer_trace.json` holds this port equal to the TypeScript, step by step.

use std::collections::HashSet;

use crate::run_items::RunChange;
use crate::{
    ActiveRun, AgentEvent, BlockDeltaEvent, BlockFinishedEvent, BlockStartedEvent,
    CompactionStartedEvent, CompactionState, Interaction, InteractionResolvedEvent, MessageId,
    ModeChangedEvent, ModeSetting, ModelChangedEvent, OpenBlock, RetryScheduledEvent, RetryState,
    RunFinishedEvent, RunStartedEvent, RunningTool, SessionSnapshot, SessionStatus, Timestamp,
    ToolFinishedEvent, ToolStartedEvent, ToolUpdate, ToolUpdatedEvent, MAX_TEXT_CHARS,
};

pub fn empty_snapshot() -> SessionSnapshot {
    SessionSnapshot {
        run: None,
        blocks: Vec::new(),
        tools: Vec::new(),
        interactions: Vec::new(),
        queue: Vec::new(),
        background_tasks: Vec::new(),
        model_id: None,
        thinking: None,
        modes: Vec::new(),
        usage: None,
        compaction: None,
        retry: None,
        last_outcome: None,
    }
}

/// What a session is doing, as the snapshot says; never `Unknown` for a session open in a bridge.
pub fn session_status(snapshot: &SessionSnapshot) -> SessionStatus {
    if snapshot
        .interactions
        .iter()
        .any(|interaction| interaction.blocks_run)
    {
        SessionStatus::WaitingForUser
    } else if snapshot.run.is_some() {
        SessionStatus::Running
    } else {
        SessionStatus::Idle
    }
}

/// The live state after `event`, which the bridge recorded at `at`.
pub fn apply_event(snapshot: &mut SessionSnapshot, at: Timestamp, event: AgentEvent) {
    let change = snapshot
        .run
        .is_some()
        .then(|| RunChange::of(snapshot, at, &event));
    apply_to_live_state(snapshot, at, event);
    if let (Some(change), Some(run)) = (change, snapshot.run.as_mut()) {
        change.apply(run);
    }
}

fn apply_to_live_state(snapshot: &mut SessionSnapshot, at: Timestamp, event: AgentEvent) {
    match event {
        AgentEvent::RunStarted(started) => snapshot.run = Some(new_run(started, at)),
        AgentEvent::RunFinished(finished) => finish_run(snapshot, finished),
        AgentEvent::BlockStarted(started) => snapshot.blocks.push(open_block(started)),
        AgentEvent::BlockDelta(delta) => append_text(&mut snapshot.blocks, &delta),
        AgentEvent::BlockFinished(finished) => finish_block(&mut snapshot.blocks, &finished),
        AgentEvent::ToolStarted(started) => snapshot.tools.push(running_tool(started)),
        AgentEvent::ToolUpdated(updated) => update_tools(&mut snapshot.tools, &updated),
        AgentEvent::ToolFinished(finished) => finish_tool(&mut snapshot.tools, &finished),
        AgentEvent::InteractionRequested(requested) => {
            snapshot.interactions.push(requested.interaction);
        }
        AgentEvent::InteractionResolved(resolved) => {
            resolve_interaction(&mut snapshot.interactions, &resolved);
        }
        AgentEvent::QueueChanged(changed) => snapshot.queue = changed.items,
        AgentEvent::BackgroundTasksChanged(changed) => snapshot.background_tasks = changed.tasks,
        AgentEvent::CompactionStarted(started) => {
            snapshot.compaction = Some(compaction_state(started, at));
        }
        AgentEvent::CompactionFinished(_) => snapshot.compaction = None,
        AgentEvent::RetryScheduled(scheduled) => snapshot.retry = Some(retry_state(scheduled)),
        AgentEvent::RetryFinished(_) => snapshot.retry = None,
        AgentEvent::UsageUpdated(updated) => snapshot.usage = Some(updated.usage),
        AgentEvent::MessagesRetracted(retracted) => retract(snapshot, retracted.message_ids),
        AgentEvent::ModelChanged(changed) => change_model(snapshot, changed),
        AgentEvent::ModeChanged(changed) => set_mode(&mut snapshot.modes, changed),
        AgentEvent::Resynced(resynced) => *snapshot = resynced.snapshot,
        AgentEvent::UserMessage(_)
        | AgentEvent::InputReturned(_)
        | AgentEvent::Notice(_)
        | AgentEvent::Activity(_)
        | AgentEvent::Error(_)
        | AgentEvent::Extension(_)
        | AgentEvent::SessionReplaced(_) => {}
    }
}

fn new_run(started: RunStartedEvent, at: Timestamp) -> ActiveRun {
    ActiveRun {
        run_id: started.run_id,
        trigger: started.trigger,
        started_at: at,
        items: Vec::new(),
        dropped_items: 0,
    }
}

fn finish_run(snapshot: &mut SessionSnapshot, finished: RunFinishedEvent) {
    snapshot.run = None;
    snapshot.retry = None;
    snapshot.last_outcome = Some(finished.outcome);
}

fn open_block(started: BlockStartedEvent) -> OpenBlock {
    OpenBlock {
        block_id: started.block_id,
        message_id: started.message_id,
        kind: started.kind,
        parent_tool_call_id: started.parent_tool_call_id,
        text: String::new(),
    }
}

fn append_text(blocks: &mut [OpenBlock], delta: &BlockDeltaEvent) {
    for block in blocks
        .iter_mut()
        .filter(|open| open.block_id == delta.block_id)
    {
        block.text.push_str(&delta.text);
        keep_newest(&mut block.text);
    }
}

fn finish_block(blocks: &mut Vec<OpenBlock>, finished: &BlockFinishedEvent) {
    blocks.retain(|open| open.block_id != finished.block_id);
}

fn running_tool(started: ToolStartedEvent) -> RunningTool {
    RunningTool {
        tool_call_id: started.tool_call_id,
        name: started.name,
        title: started.title,
        input: started.input,
        message_id: started.message_id,
        parent_tool_call_id: started.parent_tool_call_id,
        child_session: None,
        output: String::new(),
        progress: None,
        file_changes: Vec::new(),
    }
}

fn finish_tool(tools: &mut Vec<RunningTool>, finished: &ToolFinishedEvent) {
    tools.retain(|tool| tool.tool_call_id != finished.tool_call_id);
}

fn resolve_interaction(interactions: &mut Vec<Interaction>, resolved: &InteractionResolvedEvent) {
    interactions.retain(|ask| ask.id != resolved.interaction_id);
}

fn compaction_state(started: CompactionStartedEvent, at: Timestamp) -> CompactionState {
    CompactionState {
        trigger: started.trigger,
        started_at: at,
    }
}

fn change_model(snapshot: &mut SessionSnapshot, changed: ModelChangedEvent) {
    snapshot.model_id = changed.model_id;
    snapshot.thinking = changed.thinking;
}

fn retry_state(scheduled: RetryScheduledEvent) -> RetryState {
    RetryState {
        attempt: scheduled.attempt,
        max_attempts: scheduled.max_attempts,
        retry_at: scheduled.retry_at,
        message: scheduled.message,
    }
}

/// The retracted messages' open blocks and running tools disappear; a tool of no message stays.
fn retract(snapshot: &mut SessionSnapshot, message_ids: Vec<MessageId>) {
    let retracted: HashSet<MessageId> = message_ids.into_iter().collect();
    snapshot
        .blocks
        .retain(|open| !retracted.contains(&open.message_id));
    snapshot.tools.retain(|tool| {
        tool.message_id
            .as_ref()
            .is_none_or(|message_id| !retracted.contains(message_id))
    });
}

fn update_tools(tools: &mut [RunningTool], updated: &ToolUpdatedEvent) {
    for tool in tools
        .iter_mut()
        .filter(|tool| tool.tool_call_id == updated.tool_call_id)
    {
        update_tool(tool, &updated.update);
    }
}

fn update_tool(tool: &mut RunningTool, update: &ToolUpdate) {
    match update {
        ToolUpdate::Input(set) => tool.input = Some(set.input.clone()),
        ToolUpdate::OutputAppended(appended) => {
            tool.output.push_str(&appended.text);
            keep_newest(&mut tool.output);
        }
        ToolUpdate::OutputReplaced(replaced) => tool.output.clone_from(&replaced.text),
        ToolUpdate::Progress(progress) => tool.progress = Some(progress.message.clone()),
        ToolUpdate::FileChanges(changes) => tool.file_changes.clone_from(&changes.changes),
        ToolUpdate::ChildSession(child) => tool.child_session = Some(child.session.clone()),
    }
}

fn set_mode(modes: &mut Vec<ModeSetting>, changed: ModeChangedEvent) {
    let setting = ModeSetting {
        axis: changed.axis,
        value: changed.value,
    };
    if modes.iter().any(|mode| mode.axis == setting.axis) {
        for mode in modes.iter_mut().filter(|mode| mode.axis == setting.axis) {
            mode.clone_from(&setting);
        }
    } else {
        modes.push(setting);
    }
}

/// Keeps the last `MAX_TEXT_CHARS` of `text`. JavaScript counts a string in UTF-16 units, and where the
/// cut would split a surrogate pair the TypeScript drops the pair's low half too, so a character the cut
/// splits goes whole.
fn keep_newest(text: &mut String) {
    // No character has more UTF-16 units than UTF-8 bytes.
    if text.len() <= MAX_TEXT_CHARS {
        return;
    }
    let mut units = 0;
    let mut start = text.len();
    for (index, character) in text.char_indices().rev() {
        units += character.len_utf16();
        if units > MAX_TEXT_CHARS {
            break;
        }
        start = index;
    }
    text.drain(..start);
}
