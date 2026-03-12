// Codex dynamic tool call model.
//
// Matches the SDK `dynamicToolCall` thread item type.
// Used when plugins/skills define client-side tools that the LLM can invoke.

enum CodexDynamicToolCallStatus {
  inProgress,
  completed,
  failed;

  static CodexDynamicToolCallStatus fromString(String value) {
    switch (value) {
      case 'completed':
        return CodexDynamicToolCallStatus.completed;
      case 'failed':
        return CodexDynamicToolCallStatus.failed;
      default:
        return CodexDynamicToolCallStatus.inProgress;
    }
  }

  String get icon {
    switch (this) {
      case CodexDynamicToolCallStatus.inProgress:
        return '⏳';
      case CodexDynamicToolCallStatus.completed:
        return '✅';
      case CodexDynamicToolCallStatus.failed:
        return '❌';
    }
  }
}

class CodexDynamicToolCallOutputItem {
  final String type; // 'text' or 'image'
  final String? text;
  final String? url;
  final String? mimeType;

  const CodexDynamicToolCallOutputItem({
    required this.type,
    this.text,
    this.url,
    this.mimeType,
  });

  factory CodexDynamicToolCallOutputItem.fromJson(Map<String, dynamic> json) {
    return CodexDynamicToolCallOutputItem(
      type: json['type'] as String? ?? 'text',
      text: json['text'] as String?,
      url: json['url'] as String?,
      mimeType: json['mimeType'] as String?,
    );
  }
}

class CodexDynamicToolCall {
  final String callId;
  final String tool;
  final dynamic arguments;
  final CodexDynamicToolCallStatus status;
  final List<CodexDynamicToolCallOutputItem> contentItems;
  final bool success;

  const CodexDynamicToolCall({
    required this.callId,
    required this.tool,
    this.arguments,
    this.status = CodexDynamicToolCallStatus.inProgress,
    this.contentItems = const [],
    this.success = false,
  });

  factory CodexDynamicToolCall.fromJson(Map<String, dynamic> json) {
    return CodexDynamicToolCall(
      callId: json['callId'] as String? ?? json['id'] as String? ?? '',
      tool: json['tool'] as String? ?? json['name'] as String? ?? '',
      arguments: json['arguments'],
      status: CodexDynamicToolCallStatus.fromString(
        json['status'] as String? ?? 'inProgress',
      ),
      contentItems:
          (json['contentItems'] as List<dynamic>?)
              ?.map(
                (e) => CodexDynamicToolCallOutputItem.fromJson(
                  e as Map<String, dynamic>,
                ),
              )
              .toList() ??
          const [],
      success: json['success'] as bool? ?? false,
    );
  }
}
