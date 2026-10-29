import 'package:broski/contract/generated/contract.dart';

/// [snapshot] with the fields given replaced; a field left null is kept.
SessionSnapshot replacing(
  SessionSnapshot snapshot, {
  ActiveRun? run,
  List<OpenBlock>? blocks,
  List<RunningTool>? tools,
  List<Interaction>? interactions,
  List<QueueItem>? queue,
  ModelId? modelId,
  String? thinking,
  List<ModeSetting>? modes,
  Usage? usage,
  Plan? plan,
  CompactionState? compaction,
  RetryState? retry,
  RunOutcome? lastOutcome,
}) => SessionSnapshot(
  run: run ?? snapshot.run,
  blocks: blocks ?? snapshot.blocks,
  tools: tools ?? snapshot.tools,
  interactions: interactions ?? snapshot.interactions,
  queue: queue ?? snapshot.queue,
  modelId: modelId ?? snapshot.modelId,
  thinking: thinking ?? snapshot.thinking,
  modes: modes ?? snapshot.modes,
  usage: usage ?? snapshot.usage,
  plan: plan ?? snapshot.plan,
  compaction: compaction ?? snapshot.compaction,
  retry: retry ?? snapshot.retry,
  lastOutcome: lastOutcome ?? snapshot.lastOutcome,
);

/// [snapshot] without the optional fields named.
SessionSnapshot clearing(
  SessionSnapshot snapshot, {
  bool run = false,
  bool retry = false,
  bool compaction = false,
  bool model = false,
}) => SessionSnapshot(
  run: run ? null : snapshot.run,
  blocks: snapshot.blocks,
  tools: snapshot.tools,
  interactions: snapshot.interactions,
  queue: snapshot.queue,
  modelId: model ? null : snapshot.modelId,
  thinking: model ? null : snapshot.thinking,
  modes: snapshot.modes,
  usage: snapshot.usage,
  plan: snapshot.plan,
  compaction: compaction ? null : snapshot.compaction,
  retry: retry ? null : snapshot.retry,
  lastOutcome: snapshot.lastOutcome,
);

ActiveRun runWith(
  ActiveRun run, {
  required List<TranscriptItem> items,
  int? droppedItems,
}) => ActiveRun(
  runId: run.runId,
  trigger: run.trigger,
  startedAt: run.startedAt,
  items: items,
  droppedItems: droppedItems ?? run.droppedItems,
);

/// [tool] with the fields given replaced; a field left null is kept.
RunningTool toolWith(
  RunningTool tool, {
  JsonValue? input,
  SessionRef? childSession,
  String? output,
  String? progress,
  List<FileChange>? fileChanges,
}) => RunningTool(
  toolCallId: tool.toolCallId,
  name: tool.name,
  title: tool.title,
  input: input ?? tool.input,
  messageId: tool.messageId,
  parentToolCallId: tool.parentToolCallId,
  childSession: childSession ?? tool.childSession,
  output: output ?? tool.output,
  progress: progress ?? tool.progress,
  fileChanges: fileChanges ?? tool.fileChanges,
);

OpenBlock blockWithText(OpenBlock block, String text) => OpenBlock(
  blockId: block.blockId,
  messageId: block.messageId,
  kind: block.kind,
  parentToolCallId: block.parentToolCallId,
  text: text,
);
