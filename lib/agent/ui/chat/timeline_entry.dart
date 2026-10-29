import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/contract/generated/contract.dart';

/// One row of the conversation as the chat view draws it.
sealed class TimelineEntry {
  const TimelineEntry();

  /// Stable across rebuilds, so a row keeps its expanded state.
  String get key;
}

final class UserEntry extends TimelineEntry {
  const UserEntry(this.item);

  final UserMessageItem item;

  @override
  String get key => 'user:${item.id}';
}

/// A prompt of this phone the session has not echoed yet.
final class PendingPromptEntry extends TimelineEntry {
  const PendingPromptEntry(this.prompt);

  final OutgoingPrompt prompt;

  @override
  String get key => 'prompt:${prompt.clientRequestId}';
}

final class BlockEntry extends TimelineEntry {
  const BlockEntry({
    required this.id,
    required this.kind,
    required this.text,
    required this.streaming,
  });

  final String id;
  final BlockKind kind;
  final String text;
  final bool streaming;

  @override
  String get key => 'block:$id';
}

/// A tool call with what is known of it: its live progress while it runs,
/// its result once it finished, and the subagent work nested inside it.
final class ToolEntry extends TimelineEntry {
  const ToolEntry({
    required this.toolCallId,
    required this.name,
    this.title,
    this.input,
    this.running,
    this.result,
    this.childSession,
    this.nested = const [],
  });

  final ToolCallId toolCallId;
  final String name;
  final String? title;
  final JsonValue? input;
  final RunningTool? running;
  final ToolResultItem? result;
  final SessionRef? childSession;
  final List<TimelineEntry> nested;

  @override
  String get key => 'tool:$toolCallId';
}

/// A transcript row that is not a turn: a notice, a compaction, a model
/// change, where a run ended.
final class MarkerEntry extends TimelineEntry {
  const MarkerEntry(this.item);

  final TranscriptItem item;

  @override
  String get key => 'marker:${item.id}';
}

/// Items of a long run the live view no longer holds; the transcript shows
/// them once the run ends (`droppedItems`, contract §8).
final class DroppedEntry extends TimelineEntry {
  const DroppedEntry({required this.count, required this.where});

  final int count;
  final String where;

  @override
  String get key => 'dropped:$where';
}
