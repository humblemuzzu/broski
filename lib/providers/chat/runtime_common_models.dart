import 'package:broski/models/agent_type.dart';
import 'package:broski/models/message.dart';

class RuntimeChatTurnState {
  const RuntimeChatTurnState({
    required this.backend,
    required this.sessionKey,
    this.sessionId,
    this.cwd,
    this.messageId,
    this.isStreaming = false,
    this.turnIndex = 0,
    this.assistantText = '',
    this.thinkingText = '',
    this.tools = const {},
    this.parts = const [],
    this.nextPartSequence = 0,
    this.recentEventFingerprints = const [],
  });

  final AgentType backend;
  final String sessionKey;
  final String? sessionId;
  final String? cwd;
  final String? messageId;
  final bool isStreaming;
  final int turnIndex;
  final String assistantText;
  final String thinkingText;
  final Map<String, ToolCall> tools;
  final List<MessagePart> parts;
  final int nextPartSequence;
  final List<String> recentEventFingerprints;

  bool get hasVisibleContent =>
      assistantText.isNotEmpty || thinkingText.isNotEmpty || tools.isNotEmpty;

  RuntimeChatTurnState copyWith({
    String? sessionId,
    String? cwd,
    String? messageId,
    bool? isStreaming,
    int? turnIndex,
    String? assistantText,
    String? thinkingText,
    Map<String, ToolCall>? tools,
    List<MessagePart>? parts,
    int? nextPartSequence,
    List<String>? recentEventFingerprints,
  }) {
    return RuntimeChatTurnState(
      backend: backend,
      sessionKey: sessionKey,
      sessionId: sessionId ?? this.sessionId,
      cwd: cwd ?? this.cwd,
      messageId: messageId ?? this.messageId,
      isStreaming: isStreaming ?? this.isStreaming,
      turnIndex: turnIndex ?? this.turnIndex,
      assistantText: assistantText ?? this.assistantText,
      thinkingText: thinkingText ?? this.thinkingText,
      tools: tools ?? this.tools,
      parts: parts ?? this.parts,
      nextPartSequence: nextPartSequence ?? this.nextPartSequence,
      recentEventFingerprints:
          recentEventFingerprints ?? this.recentEventFingerprints,
    );
  }
}

ChatMessage? buildRuntimeChatMessage(
  RuntimeChatTurnState turn, {
  required DateTime createdAt,
  required List<DiffEntry> diffs,
}) {
  final messageId = turn.messageId;
  final sessionId = turn.sessionId;
  if (messageId == null || messageId.isEmpty) return null;
  if (sessionId == null || sessionId.isEmpty) return null;
  if (!turn.hasVisibleContent) return null;

  final lastTextIndex = turn.parts.lastIndexWhere((part) => part is TextPart);
  final parts = <MessagePart>[];
  for (var i = 0; i < turn.parts.length; i++) {
    final part = turn.parts[i];
    if (part is TextPart) {
      parts.add(
        part.copyWith(isStreaming: i == lastTextIndex && turn.isStreaming),
      );
    } else {
      parts.add(part);
    }
  }

  final reasoningParts = turn.thinkingText.isEmpty
      ? const <ReasoningPart>[]
      : [
          ReasoningPart(
            id: '$messageId-thinking',
            messageId: messageId,
            text: turn.thinkingText,
            isStreaming: turn.isStreaming,
          ),
        ];

  return ChatMessage(
    id: messageId,
    sessionId: sessionId,
    role: MessageRole.assistant,
    createdAt: createdAt,
    text: turn.assistantText,
    toolCalls: turn.tools.values.toList(growable: false),
    diffs: diffs,
    reasoningParts: reasoningParts,
    parts: parts,
    isStreaming: turn.isStreaming,
  );
}

String buildRuntimeChatSessionKey({
  required AgentType backend,
  String? sessionId,
  String? cwd,
}) {
  final normalizedSessionId = (sessionId ?? '').trim();
  if (normalizedSessionId.isNotEmpty) {
    return '${backend.wireValue}::$normalizedSessionId';
  }

  final normalizedCwd = (cwd ?? '').trim();
  if (normalizedCwd.isNotEmpty) {
    return '${backend.wireValue}::cwd::$normalizedCwd';
  }

  return '${backend.wireValue}::unknown';
}
