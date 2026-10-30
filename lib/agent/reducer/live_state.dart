import 'package:broski/agent/reducer/newest_text.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/contract/generated/contract.dart';

/// The live state after [event], before the active run's items are updated.
/// Mirrors `applyToLiveState` in `session-reducer.ts`, one arm per event.
SessionSnapshot applyToLiveState(
  SessionSnapshot s,
  Timestamp at,
  AgentEvent event,
) => switch (event) {
  RunStartedEvent() => replacing(s, run: _startedRun(event, at)),
  RunFinishedEvent() => _runFinished(s, event),
  BlockStartedEvent() => replacing(s, blocks: [...s.blocks, _block(event)]),
  BlockDeltaEvent() => replacing(s, blocks: _withDelta(s, event)),
  BlockFinishedEvent() => replacing(s, blocks: _withoutBlock(s, event)),
  ToolStartedEvent() => replacing(s, tools: [...s.tools, _tool(event)]),
  ToolUpdatedEvent() => replacing(s, tools: _withUpdate(s, event)),
  ToolFinishedEvent() => replacing(s, tools: _withoutTool(s, event)),
  InteractionRequestedEvent() => replacing(
    s,
    interactions: [...s.interactions, event.interaction],
  ),
  InteractionResolvedEvent() => replacing(
    s,
    interactions: _withoutAsk(s, event),
  ),
  QueueChangedEvent() => replacing(s, queue: event.items),
  CompactionStartedEvent() => replacing(s, compaction: _compaction(event, at)),
  CompactionFinishedEvent() => clearing(s, compaction: true),
  RetryScheduledEvent() => replacing(s, retry: _retry(event)),
  RetryFinishedEvent() => clearing(s, retry: true),
  UsageUpdatedEvent() => replacing(s, usage: event.usage),
  PlanUpdatedEvent() => replacing(s, plan: event.plan),
  MessagesRetractedEvent() => _retracted(s, event.messageIds.toSet()),
  ModelChangedEvent() => _modelChanged(s, event),
  ModeChangedEvent() => replacing(s, modes: _modesWith(s.modes, event)),
  ResyncedEvent() => event.snapshot,
  UserMessageEvent() ||
  InputReturnedEvent() ||
  NoticeEvent() ||
  ErrorEvent() ||
  ExtensionEvent() ||
  SessionReplacedEvent() => s,
};

ActiveRun _startedRun(RunStartedEvent event, Timestamp at) => ActiveRun(
  runId: event.runId,
  trigger: event.trigger,
  startedAt: at,
  items: const [],
  droppedItems: 0,
);

SessionSnapshot _runFinished(SessionSnapshot s, RunFinishedEvent event) =>
    replacing(clearing(s, run: true, retry: true), lastOutcome: event.outcome);

OpenBlock _block(BlockStartedEvent event) => OpenBlock(
  blockId: event.blockId,
  messageId: event.messageId,
  kind: event.kind,
  parentToolCallId: event.parentToolCallId,
  text: '',
);

List<OpenBlock> _withDelta(SessionSnapshot s, BlockDeltaEvent event) => [
  for (final block in s.blocks)
    block.blockId == event.blockId
        ? blockWithText(block, newestText(block.text + event.text))
        : block,
];

List<OpenBlock> _withoutBlock(SessionSnapshot s, BlockFinishedEvent event) => [
  for (final block in s.blocks)
    if (block.blockId != event.blockId) block,
];

RunningTool _tool(ToolStartedEvent event) => RunningTool(
  toolCallId: event.toolCallId,
  name: event.name,
  title: event.title,
  input: event.input,
  messageId: event.messageId,
  parentToolCallId: event.parentToolCallId,
  output: '',
  fileChanges: const [],
);

List<RunningTool> _withUpdate(SessionSnapshot s, ToolUpdatedEvent event) => [
  for (final tool in s.tools)
    tool.toolCallId == event.toolCallId ? _updated(tool, event.update) : tool,
];

List<RunningTool> _withoutTool(SessionSnapshot s, ToolFinishedEvent event) => [
  for (final tool in s.tools)
    if (tool.toolCallId != event.toolCallId) tool,
];

RunningTool _updated(RunningTool tool, ToolUpdate update) => switch (update) {
  ToolInputSet() => toolWith(tool, input: update.input),
  ToolOutputAppended() => toolWith(
    tool,
    output: newestText(tool.output + update.text),
  ),
  ToolOutputReplaced() => toolWith(tool, output: update.text),
  ToolProgress() => toolWith(tool, progress: update.message),
  ToolFileChanges() => toolWith(tool, fileChanges: update.changes),
  ToolChildSession() => toolWith(tool, childSession: update.session),
};

List<Interaction> _withoutAsk(
  SessionSnapshot s,
  InteractionResolvedEvent event,
) => [
  for (final asked in s.interactions)
    if (asked.id != event.interactionId) asked,
];

CompactionState _compaction(CompactionStartedEvent event, Timestamp at) =>
    CompactionState(trigger: event.trigger, startedAt: at);

RetryState _retry(RetryScheduledEvent event) => RetryState(
  attempt: event.attempt,
  maxAttempts: event.maxAttempts,
  retryAt: event.retryAt,
  message: event.message,
);

SessionSnapshot _retracted(SessionSnapshot s, Set<MessageId> retracted) =>
    replacing(
      s,
      blocks: [
        for (final block in s.blocks)
          if (!retracted.contains(block.messageId)) block,
      ],
      tools: [
        for (final tool in s.tools)
          if (!retracted.contains(tool.messageId)) tool,
      ],
    );

/// Both replaced: a field the event leaves out is cleared.
SessionSnapshot _modelChanged(SessionSnapshot s, ModelChangedEvent event) =>
    replacing(
      clearing(s, model: true),
      modelId: event.modelId,
      thinking: event.thinking,
    );

List<ModeSetting> _modesWith(List<ModeSetting> modes, ModeChangedEvent event) {
  final setting = ModeSetting(axis: event.axis, value: event.value);
  final known = modes.any((mode) => mode.axis == event.axis);
  if (!known) return [...modes, setting];
  return [for (final mode in modes) mode.axis == event.axis ? setting : mode];
}
