import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/contract/generated/contract.dart';

/// The id a tool call's result item has when it comes from the live stream.
String resultItemId(ToolCallId toolCallId) => '$toolCallId:result';

/// The items [event] finishes, in the live stream's ids; [before] is the live
/// state the event applies to. Mirrors `finishedItems` in `run-items.ts`.
List<TranscriptItem> finishedItems(
  SessionSnapshot before,
  Timestamp at,
  AgentEvent event,
) => switch (event) {
  UserMessageEvent() => [_userItem(event, at)],
  BlockFinishedEvent() => [
    ?before.blocks
        .where((open) => open.blockId == event.blockId)
        .map((open) => _blockItem(open, event, at))
        .firstOrNull,
  ],
  ToolStartedEvent() => [_callItem(event, at)],
  ToolFinishedEvent() => [_resultItem(event, at)],
  _ => const [],
};

UserMessageItem _userItem(UserMessageEvent event, Timestamp at) =>
    UserMessageItem(
      id: event.messageId,
      at: at,
      text: event.text,
      attachments: event.attachments,
      clientRequestId: event.clientRequestId,
    );

/// The block's authoritative text is the event's; the open text was partial.
BlockItem _blockItem(OpenBlock block, BlockFinishedEvent event, Timestamp at) =>
    BlockItem(
      id: block.blockId,
      at: at,
      messageId: block.messageId,
      block: block.kind,
      text: event.text,
      parentToolCallId: block.parentToolCallId,
    );

ToolCallItem _callItem(ToolStartedEvent event, Timestamp at) => ToolCallItem(
  id: event.toolCallId,
  at: at,
  toolCallId: event.toolCallId,
  messageId: event.messageId,
  name: event.name,
  title: event.title,
  input: event.input,
  parentToolCallId: event.parentToolCallId,
);

ToolResultItem _resultItem(ToolFinishedEvent event, Timestamp at) =>
    ToolResultItem(
      id: resultItemId(event.toolCallId),
      at: at,
      toolCallId: event.toolCallId,
      outcome: event.outcome,
      result: event.result,
    );

/// A tool call item as it stands when the call finishes: with the input and
/// child session it learnt while running.
ToolCallItem completedCall(ToolCallItem item, SessionSnapshot before) {
  final tool = before.tools
      .where((running) => running.toolCallId == item.toolCallId)
      .firstOrNull;
  if (tool == null) return item;
  return ToolCallItem(
    id: item.id,
    at: item.at,
    toolCallId: item.toolCallId,
    messageId: item.messageId,
    name: item.name,
    title: item.title,
    input: tool.input ?? item.input,
    parentToolCallId: item.parentToolCallId,
    childSession: tool.childSession ?? item.childSession,
  );
}

/// [items] without the retracted messages' blocks and tool calls, and without
/// those calls' results.
List<TranscriptItem> withoutRetracted(
  List<TranscriptItem> items,
  List<MessageId> messageIds,
) {
  final retracted = messageIds.toSet();
  final calls = {
    for (final item in items)
      if (item is ToolCallItem && retracted.contains(item.messageId))
        item.toolCallId,
  };
  return [
    for (final item in items)
      if (switch (item) {
        BlockItem() => !retracted.contains(item.messageId),
        ToolCallItem() => !calls.contains(item.toolCallId),
        ToolResultItem() => !calls.contains(item.toolCallId),
        UserMessageItem() ||
        NoticeItem() ||
        CompactionItem() ||
        ModelChangeItem() ||
        RunBoundaryItem() ||
        ActivityItem() => true,
      })
        item,
  ];
}

/// The active run after [event]. Mirrors `nextRun` in `run-items.ts`.
ActiveRun nextRun(
  ActiveRun run,
  SessionSnapshot before,
  Timestamp at,
  AgentEvent event,
) => switch (event) {
  SessionReplacedEvent() => runWith(run, items: const [], droppedItems: 0),
  MessagesRetractedEvent() => runWith(
    run,
    items: withoutRetracted(run.items, event.messageIds),
  ),
  ToolFinishedEvent() => _bounded(run, [
    for (final item in run.items)
      item is ToolCallItem && item.toolCallId == event.toolCallId
          ? completedCall(item, before)
          : item,
    ...finishedItems(before, at, event),
  ]),
  ActivityEvent() => _withActivity(run, at, event.activity),
  _ => _bounded(run, [...run.items, ...finishedItems(before, at, event)]),
};

/// One item per activity id: a later state replaces it where it stands and
/// keeps the time it began.
ActiveRun _withActivity(ActiveRun run, Timestamp at, Activity activity) {
  final held = run.items
      .where((item) => item is ActivityItem && item.id == activity.id)
      .firstOrNull;
  final item = ActivityItem(
    at: held?.at ?? at,
    id: activity.id,
    label: activity.label,
    detail: activity.detail,
    status: activity.status,
    output: activity.output,
    durationMs: activity.durationMs,
  );
  if (held == null) return _bounded(run, [...run.items, item]);
  return runWith(
    run,
    items: [
      for (final other in run.items) identical(other, held) ? item : other,
    ],
  );
}

ActiveRun _bounded(ActiveRun run, List<TranscriptItem> items) {
  final excess = items.length - contractMaxListItems;
  if (excess <= 0) return runWith(run, items: items);
  return runWith(
    run,
    items: items.sublist(excess),
    droppedItems: run.droppedItems + excess,
  );
}
