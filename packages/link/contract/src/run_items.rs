//! How live events become the active run's items (`run-items.ts`).

use std::collections::HashSet;

use crate::{
    ActiveRun, ActivityItem, AgentEvent, BlockItem, JsonValue, MessageId, SessionRef,
    SessionSnapshot, Timestamp, ToolCallId, ToolCallItem, ToolResultItem, TranscriptItem,
    UserMessageItem, MAX_RUN_ITEMS,
};

/// What an event does to the active run's items, read from the live state before the event: the
/// reducer applies the event to the live state in place, and a finished block or tool is gone after.
pub(crate) enum RunChange {
    /// What came before belongs to the old session.
    Restart,
    Retract(Vec<MessageId>),
    /// The call item completed with what the running tool learnt, and its result appended.
    Finish {
        tool_call_id: ToolCallId,
        input: Option<JsonValue>,
        child_session: Option<SessionRef>,
        result: Option<TranscriptItem>,
    },
    Append(Option<TranscriptItem>),
}

impl RunChange {
    pub(crate) fn of(before: &SessionSnapshot, at: Timestamp, event: &AgentEvent) -> RunChange {
        match event {
            AgentEvent::SessionReplaced(_) => RunChange::Restart,
            AgentEvent::MessagesRetracted(retracted) => {
                RunChange::Retract(retracted.message_ids.clone())
            }
            AgentEvent::ToolFinished(finished) => {
                let running = before
                    .tools
                    .iter()
                    .find(|tool| tool.tool_call_id == finished.tool_call_id);
                RunChange::Finish {
                    tool_call_id: finished.tool_call_id.clone(),
                    input: running.and_then(|tool| tool.input.clone()),
                    child_session: running.and_then(|tool| tool.child_session.clone()),
                    result: finished_item(before, at, event),
                }
            }
            _ => RunChange::Append(finished_item(before, at, event)),
        }
    }

    pub(crate) fn apply(self, run: &mut ActiveRun) {
        match self {
            RunChange::Restart => {
                run.items.clear();
                run.dropped_items = 0;
            }
            RunChange::Retract(message_ids) => remove_retracted(&mut run.items, &message_ids),
            RunChange::Finish {
                tool_call_id,
                input,
                child_session,
                result,
            } => {
                for item in &mut run.items {
                    if let TranscriptItem::ToolCall(call) = item {
                        if call.tool_call_id == tool_call_id {
                            complete_call(call, input.as_ref(), child_session.as_ref());
                        }
                    }
                }
                append_bounded(run, result);
            }
            RunChange::Append(item) => append_bounded(run, item),
        }
    }
}

/// The item `event` finishes, in the live stream's ids: a user message, a finished block, a started
/// tool call, a tool result, an activity.
fn finished_item(
    before: &SessionSnapshot,
    at: Timestamp,
    event: &AgentEvent,
) -> Option<TranscriptItem> {
    match event {
        AgentEvent::UserMessage(message) => Some(TranscriptItem::UserMessage(UserMessageItem {
            id: message.message_id.clone(),
            at: Some(at),
            text: message.text.clone(),
            attachments: message.attachments.clone(),
            client_request_id: message.client_request_id.clone(),
        })),
        AgentEvent::BlockFinished(finished) => {
            let block = before
                .blocks
                .iter()
                .find(|open| open.block_id == finished.block_id)?;
            Some(TranscriptItem::Block(BlockItem {
                id: block.block_id.clone(),
                at: Some(at),
                message_id: block.message_id.clone(),
                block: block.kind,
                text: finished.text.clone(),
                parent_tool_call_id: block.parent_tool_call_id.clone(),
            }))
        }
        AgentEvent::ToolStarted(started) => Some(TranscriptItem::ToolCall(ToolCallItem {
            id: started.tool_call_id.clone(),
            at: Some(at),
            tool_call_id: started.tool_call_id.clone(),
            message_id: started.message_id.clone(),
            name: started.name.clone(),
            title: started.title.clone(),
            input: started.input.clone(),
            parent_tool_call_id: started.parent_tool_call_id.clone(),
            child_session: None,
        })),
        AgentEvent::ToolFinished(finished) => Some(TranscriptItem::ToolResult(ToolResultItem {
            id: format!("{}:result", finished.tool_call_id),
            at: Some(at),
            tool_call_id: finished.tool_call_id.clone(),
            outcome: finished.outcome,
            result: finished.result.clone(),
        })),
        AgentEvent::Activity(activity) => Some(TranscriptItem::Activity(ActivityItem {
            id: activity.activity_id.clone(),
            at: Some(at),
            activity: activity.activity.clone(),
        })),
        _ => None,
    }
}

/// What the running tool learnt replaces what the call started with; what it never learnt stays.
fn complete_call(
    call: &mut ToolCallItem,
    input: Option<&JsonValue>,
    child_session: Option<&SessionRef>,
) {
    if let Some(input) = input {
        call.input = Some(input.clone());
    }
    if let Some(child_session) = child_session {
        call.child_session = Some(child_session.clone());
    }
}

/// Without the retracted messages' blocks and tool calls, and without those calls' results.
fn remove_retracted(items: &mut Vec<TranscriptItem>, message_ids: &[MessageId]) {
    let retracted: HashSet<&str> = message_ids.iter().map(String::as_str).collect();
    let calls: HashSet<ToolCallId> = items
        .iter()
        .filter_map(|item| match item {
            TranscriptItem::ToolCall(call)
                if call
                    .message_id
                    .as_deref()
                    .is_some_and(|id| retracted.contains(id)) =>
            {
                Some(call.tool_call_id.clone())
            }
            _ => None,
        })
        .collect();
    items.retain(|item| match item {
        TranscriptItem::Block(block) => !retracted.contains(block.message_id.as_str()),
        TranscriptItem::ToolCall(call) => !calls.contains(&call.tool_call_id),
        TranscriptItem::ToolResult(result) => !calls.contains(&result.tool_call_id),
        _ => true,
    });
}

/// Past the bound the oldest items leave and `dropped_items` counts them.
fn append_bounded(run: &mut ActiveRun, item: Option<TranscriptItem>) {
    run.items.extend(item);
    let excess = run.items.len().saturating_sub(MAX_RUN_ITEMS);
    if excess > 0 {
        run.items.drain(..excess);
        run.dropped_items += excess as i64;
    }
}
