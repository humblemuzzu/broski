/// Represents an ordered part of a message (text or tool) for sequential rendering.
/// Used by Claude Code to maintain arrival order of text and tools during streaming.
sealed class MessagePart {
  const MessagePart({required this.sequence});

  /// Sequence number for ordering (arrival order)
  final int sequence;
}

/// A text segment within a message
class TextPart extends MessagePart {
  const TextPart({
    required super.sequence,
    required this.text,
    this.isStreaming = false,
  });

  final String text;
  final bool isStreaming;

  TextPart copyWith({String? text, bool? isStreaming}) {
    return TextPart(
      sequence: sequence,
      text: text ?? this.text,
      isStreaming: isStreaming ?? this.isStreaming,
    );
  }
}

/// A tool call within a message (references ToolCall by callId)
class ToolPart extends MessagePart {
  const ToolPart({required super.sequence, required this.callId});

  /// Reference to the ToolCall.callId
  final String callId;
}

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.createdAt,
    required this.text,
    this.toolCalls = const [],
    this.diffs = const [],
    this.subtaskNotifications = const [],
    this.reasoningParts = const [],
    this.parts = const [],
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

  /// Ordered parts for sequential rendering (Claude Code).
  /// When non-empty, use this for rendering order instead of fixed text-first.
  final List<MessagePart> parts;

  /// Background task completion notifications in this message
  final List<SubtaskNotification> subtaskNotifications;

  /// Model reasoning/thinking content (e.g., Claude's extended thinking)
  final List<ReasoningPart> reasoningParts;

  final bool isStreaming;
  final String? error;

  /// Whether this message has any subtask notifications
  bool get hasSubtaskNotifications => subtaskNotifications.isNotEmpty;

  /// Whether this message has any reasoning/thinking content
  bool get hasReasoning => reasoningParts.isNotEmpty;

  /// Whether any reasoning is still streaming
  bool get isReasoningStreaming =>
      reasoningParts.any((part) => part.isStreaming);

  /// Combined reasoning text from all parts
  String get reasoningText => reasoningParts.map((p) => p.text).join('');

  /// Total reasoning duration in ms (sum of all completed parts)
  int? get reasoningDurationMs {
    final completed = reasoningParts.where((p) => p.durationMs != null);
    if (completed.isEmpty) return null;
    return completed.fold<int>(0, (sum, p) => sum + (p.durationMs ?? 0));
  }

  /// Whether this message uses ordered parts for rendering
  bool get hasOrderedParts => parts.isNotEmpty;

  ChatMessage copyWith({
    String? text,
    List<ToolCall>? toolCalls,
    List<DiffEntry>? diffs,
    List<SubtaskNotification>? subtaskNotifications,
    List<ReasoningPart>? reasoningParts,
    List<MessagePart>? parts,
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
      subtaskNotifications: subtaskNotifications ?? this.subtaskNotifications,
      reasoningParts: reasoningParts ?? this.reasoningParts,
      parts: parts ?? this.parts,
      isStreaming: isStreaming ?? this.isStreaming,
      error: error ?? this.error,
    );
  }
}

enum MessageRole { user, assistant, system }

class ToolCall {
  const ToolCall({
    required this.callId,
    required this.partId,
    required this.name,
    required this.status,
    this.title,
    this.input = const {},
    this.output,
    this.metadata = const {},
  });

  /// OpenCode tool call ID (ToolPart.callID)
  final String callId;

  /// OpenCode part ID (ToolPart.id) - required for precise undo (SessionRevert.partID).
  final String partId;
  final String name;
  final String status;
  final String? title;
  final Map<String, dynamic> input;
  final String? output;
  final Map<String, dynamic> metadata;

  ToolCall copyWith({
    String? status,
    String? title,
    Map<String, dynamic>? input,
    String? output,
    Map<String, dynamic>? metadata,
  }) {
    return ToolCall(
      callId: callId,
      partId: partId,
      name: name,
      status: status ?? this.status,
      title: title ?? this.title,
      input: input ?? this.input,
      output: output ?? this.output,
      metadata: metadata ?? this.metadata,
    );
  }
}

/// Tool reference for permission requests (SDK v1.1.1+)
class ToolReference {
  const ToolReference({required this.messageId, required this.callId});

  final String messageId;
  final String callId;

  factory ToolReference.fromJson(Map<String, dynamic> json) {
    return ToolReference(
      messageId:
          (json['messageID'] as String?) ??
          (json['messageId'] as String?) ??
          (json['message_id'] as String?) ??
          '',
      callId:
          (json['callID'] as String?) ??
          (json['callId'] as String?) ??
          (json['call_id'] as String?) ??
          '',
    );
  }
}

class PermissionRequest {
  const PermissionRequest({
    required this.id,
    required this.sessionId,
    required this.title,
    this.permission,
    this.patterns = const [],
    this.always = const [],
    this.tool,
    this.command,
    this.metadata = const {},
  });

  /// Permission request ID (requestId in new SDK)
  final String id;
  final String sessionId;

  /// Human-readable title (generated from permission type)
  final String title;

  /// Permission type: "edit", "bash", "read", etc. (SDK v1.1.1+)
  final String? permission;

  /// File patterns this request covers (SDK v1.1.1+)
  final List<String> patterns;

  /// Patterns that "always allow" would approve (SDK v1.1.1+)
  final List<String> always;

  /// Tool context if permission is for a specific tool call (SDK v1.1.1+)
  final ToolReference? tool;

  /// Legacy: command text (for backward compatibility)
  final String? command;

  /// Additional metadata
  final Map<String, dynamic> metadata;

  /// Generate display title from permission type
  String get displayTitle {
    if (title.isNotEmpty) return title;
    switch (permission) {
      case 'edit':
        return 'Edit Request';
      case 'bash':
        return 'Run Command';
      case 'read':
        return 'Read File';
      case 'write':
        return 'Write File';
      default:
        return 'Permission Required';
    }
  }

  /// Check if this is a batch request (multiple patterns)
  bool get isBatchRequest => patterns.length > 1;

  /// Get icon name for permission type
  String get iconName {
    switch (permission) {
      case 'edit':
        return 'edit';
      case 'bash':
        return 'terminal';
      case 'read':
        return 'visibility';
      case 'write':
        return 'save';
      default:
        return 'security';
    }
  }
}

class DiffEntry {
  const DiffEntry({
    required this.file,
    required this.before,
    required this.after,
    required this.additions,
    required this.deletions,
    this.diff,
    this.partId,
  });

  final String file;
  final String before;
  final String after;
  final int additions;
  final int deletions;

  /// Unified diff text (preferred when available, includes hunks + context).
  final String? diff;

  /// Tool part ID (callID) that produced this diff, used for precise undo.
  final String? partId;
}

/// Represents model reasoning/thinking content.
/// These are ReasoningParts from the OpenCode SDK that show
/// the model's internal reasoning process (e.g., Claude's extended thinking).
class ReasoningPart {
  const ReasoningPart({
    required this.id,
    required this.messageId,
    required this.text,
    this.startTime,
    this.endTime,
    this.isStreaming = false,
  });

  /// Part ID
  final String id;

  /// Parent message ID
  final String messageId;

  /// The reasoning/thinking text content
  final String text;

  /// When thinking started (Unix timestamp in ms)
  final int? startTime;

  /// When thinking ended (Unix timestamp in ms)
  final int? endTime;

  /// Whether this reasoning is still streaming
  final bool isStreaming;

  /// Duration in milliseconds (if completed)
  int? get durationMs {
    if (startTime == null || endTime == null) return null;
    return endTime! - startTime!;
  }

  /// Human-readable duration (e.g., "2.3s")
  String? get durationString {
    final ms = durationMs;
    if (ms == null) return null;
    if (ms < 1000) return '${ms}ms';
    return '${(ms / 1000).toStringAsFixed(1)}s';
  }

  ReasoningPart copyWith({
    String? text,
    int? startTime,
    int? endTime,
    bool? isStreaming,
  }) {
    return ReasoningPart(
      id: id,
      messageId: messageId,
      text: text ?? this.text,
      startTime: startTime ?? this.startTime,
      endTime: endTime ?? this.endTime,
      isStreaming: isStreaming ?? this.isStreaming,
    );
  }

  /// Parse from SDK reasoning part
  factory ReasoningPart.fromJson(Map<String, dynamic> json) {
    final time = json['time'] as Map<String, dynamic>?;
    return ReasoningPart(
      id: json['id'] as String? ?? '',
      messageId:
          (json['messageID'] as String?) ??
          (json['messageId'] as String?) ??
          (json['message_id'] as String?) ??
          '',
      text: json['text'] as String? ?? '',
      startTime: time?['start'] as int?,
      endTime: time?['end'] as int?,
    );
  }
}

/// Represents a background task completion notification.
/// These are SubtaskParts from the OpenCode SDK that notify when
/// background agents complete their work.
class SubtaskNotification {
  const SubtaskNotification({
    required this.id,
    required this.description,
    required this.agent,
    required this.sessionId,
    this.prompt,
    this.command,
    this.duration,
    this.isCompleted = true,
  });

  /// Part ID
  final String id;

  /// Short description of the task (e.g., "Find auth implementations")
  final String description;

  /// Agent that ran the task (e.g., "explore", "librarian")
  final String agent;

  /// Session ID where the background task ran
  final String sessionId;

  /// Full prompt sent to the agent
  final String? prompt;

  /// Command that triggered this task (if any)
  final String? command;

  /// Duration in seconds (if available)
  final int? duration;

  /// Whether the task completed (vs still running)
  final bool isCompleted;

  /// Parse from SDK subtask part
  factory SubtaskNotification.fromJson(Map<String, dynamic> json) {
    return SubtaskNotification(
      id: json['id'] as String? ?? '',
      description: json['description'] as String? ?? 'Background task',
      agent: json['agent'] as String? ?? 'subagent',
      sessionId:
          (json['sessionID'] as String?) ??
          (json['sessionId'] as String?) ??
          (json['session_id'] as String?) ??
          '',
      prompt: json['prompt'] as String?,
      command: json['command'] as String?,
    );
  }
}
