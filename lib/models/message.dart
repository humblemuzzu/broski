class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.createdAt,
    required this.text,
    this.toolCalls = const [],
    this.diffs = const [],
    this.isStreaming = false,
    this.error,
  });

  final String id;
  final String sessionId;
  final MessageRole role;
  final DateTime createdAt;
  final String text;
  final List<ToolCall> toolCalls;
  final List<DiffEntry> diffs;
  final bool isStreaming;
  final String? error;

  ChatMessage copyWith({
    String? text,
    List<ToolCall>? toolCalls,
    List<DiffEntry>? diffs,
    bool? isStreaming,
    String? error,
  }) {
    return ChatMessage(
      id: id,
      sessionId: sessionId,
      role: role,
      createdAt: createdAt,
      text: text ?? this.text,
      toolCalls: toolCalls ?? this.toolCalls,
      diffs: diffs ?? this.diffs,
      isStreaming: isStreaming ?? this.isStreaming,
      error: error ?? this.error,
    );
  }
}

enum MessageRole { user, assistant, system }

class ToolCall {
  const ToolCall({
    required this.callId,
    required this.name,
    required this.status,
    this.title,
    this.input = const {},
    this.output,
  });

  final String callId;
  final String name;
  final String status;
  final String? title;
  final Map<String, dynamic> input;
  final String? output;

  ToolCall copyWith({
    String? status,
    String? title,
    Map<String, dynamic>? input,
    String? output,
  }) {
    return ToolCall(
      callId: callId,
      name: name,
      status: status ?? this.status,
      title: title ?? this.title,
      input: input ?? this.input,
      output: output ?? this.output,
    );
  }
}

class PermissionRequest {
  const PermissionRequest({
    required this.id,
    required this.sessionId,
    required this.title,
    this.command,
    this.metadata = const {},
  });

  final String id;
  final String sessionId;
  final String title;
  final String? command;
  final Map<String, dynamic> metadata;
}

class DiffEntry {
  const DiffEntry({
    required this.file,
    required this.before,
    required this.after,
    required this.additions,
    required this.deletions,
  });

  final String file;
  final String before;
  final String after;
  final int additions;
  final int deletions;
}
