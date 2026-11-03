import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/message.dart';
import 'package:broski/screens/agent/chat/chat_tool_call.dart';
import 'package:broski/screens/agent/chat/timeline_entry.dart';

/// One row of the chat as the app's message widgets draw it: a turn of the
/// agent, or any other timeline entry as it is.
sealed class ChatRow {
  const ChatRow();

  /// Stable across rebuilds, so a row keeps its state while it streams.
  String get key;
}

/// An entry of the timeline that is not part of a turn: what a person
/// wrote, a prompt not echoed yet, a marker, an activity, dropped items.
final class EntryRow extends ChatRow {
  const EntryRow(this.entry);

  final TimelineEntry entry;

  @override
  String get key => entry.key;
}

/// What the agent did between two other rows: its thinking, text and tool
/// calls in the order they came, as one message of the chat.
final class TurnRow extends ChatRow {
  const TurnRow({
    required this.message,
    required this.tools,
    required this.firstBlockId,
    required this.lastBlockId,
    required this.text,
  });

  final ChatMessage message;

  /// The calls of the turn, for what their cards do not draw.
  final Map<ToolCallId, ToolEntry> tools;

  /// The turn's oldest and newest text or thinking blocks: a fork "just
  /// before this" starts before the first, one "through this" keeps the last.
  final TranscriptItemId? firstBlockId;
  final TranscriptItemId? lastBlockId;

  /// The turn's text, for copying.
  final String text;

  @override
  String get key => 'turn:${message.id}';
}

/// [entries] as chat rows, oldest first. Consecutive blocks and tool calls
/// make one turn; a thinking block after other work starts the next, so the
/// thinking card stays where the thinking happened.
List<ChatRow> chatRowsOf(List<TimelineEntry> entries) {
  final rows = <ChatRow>[];
  _Turn? turn;
  void close() {
    if (turn case final open?) rows.add(open.row());
    turn = null;
  }

  for (final entry in entries) {
    switch (entry) {
      case BlockEntry(kind: BlockKind.thinking):
        if (turn?.hasParts ?? false) close();
        (turn ??= _Turn(entry.id)).addThinking(entry);
      case BlockEntry():
        (turn ??= _Turn(entry.id)).addText(entry);
      case ToolEntry():
        (turn ??= _Turn(entry.toolCallId)).addTool(entry);
      case UserEntry() ||
          PendingPromptEntry() ||
          MarkerEntry() ||
          ActivityEntry() ||
          DroppedEntry():
        close();
        rows.add(EntryRow(entry));
    }
  }
  close();
  return rows;
}

final class _Turn {
  _Turn(this.id);

  final String id;
  final _parts = <MessagePart>[];
  final _calls = <ToolCall>[];
  final _reasoning = <ReasoningPart>[];
  final _tools = <ToolCallId, ToolEntry>{};
  final _texts = <String>[];
  TranscriptItemId? _firstBlockId;
  TranscriptItemId? _lastBlockId;
  var _streaming = false;

  bool get hasParts => _parts.isNotEmpty;

  void _block(BlockEntry block) {
    _firstBlockId ??= block.id;
    _lastBlockId = block.id;
  }

  void addThinking(BlockEntry block) {
    _block(block);
    _reasoning.add(
      ReasoningPart(
        id: block.id,
        messageId: id,
        text: block.text,
        isStreaming: block.streaming,
      ),
    );
  }

  void addText(BlockEntry block) {
    _block(block);
    final text = block.kind == BlockKind.plan
        ? '**Proposed plan**\n\n${block.text}'
        : block.text;
    _parts.add(
      TextPart(
        sequence: _parts.length,
        text: text,
        isStreaming: block.streaming,
      ),
    );
    _texts.add(block.text);
    _streaming = _streaming || block.streaming;
  }

  void addTool(ToolEntry tool) {
    _parts.add(ToolPart(sequence: _parts.length, callId: tool.toolCallId));
    _calls.add(chatToolCall(tool));
    _tools[tool.toolCallId] = tool;
  }

  TurnRow row() => TurnRow(
    message: ChatMessage(
      id: id,
      sessionId: '',
      role: MessageRole.assistant,
      createdAt: DateTime.fromMillisecondsSinceEpoch(0),
      text: _texts.join('\n\n'),
      toolCalls: _calls,
      reasoningParts: _reasoning,
      parts: _parts,
      isStreaming: _streaming,
    ),
    tools: _tools,
    firstBlockId: _firstBlockId,
    lastBlockId: _lastBlockId,
    text: _texts.join('\n\n'),
  );
}
