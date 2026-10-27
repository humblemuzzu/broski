part of '../chat_provider.dart';

/// OpenCode messages from the wire, and an older page of them in front of the
/// loaded window.
extension OcTranscriptPage on ChatSessionNotifier {
  /// One message of an OpenCode transcript, or null when the entry carries no
  /// visible content.
  ChatMessage? openCodeTranscriptMessage(Map<String, dynamic> item) {
    final info = item['info'] as Map<String, dynamic>? ?? const {};
    final messageId = info['id'] as String? ?? '';
    if (messageId.isEmpty) return null;

    final parts = item['parts'] as List<dynamic>? ?? const [];
    final collected = _OcPartCollection();
    for (final partItem in parts) {
      if (partItem is Map<String, dynamic>) {
        collected.add(partItem, _openCodeTool);
      }
    }

    final role = info['role'] as String? ?? 'assistant';
    final text = collected.text.toString();
    // A user message left with nothing visible is system-injected context, not
    // something the user typed.
    if (role == 'user' && text.isEmpty && collected.tools.isEmpty) {
      return null;
    }
    final diffs = <DiffEntry>[];
    for (final tool in collected.tools) {
      final diff = _extractDiffFromTool(tool);
      if (diff != null) diffs.add(diff);
    }
    final created =
        info['time']?['created'] as int? ??
        DateTime.now().millisecondsSinceEpoch;
    return ChatMessage(
      id: messageId,
      sessionId:
          info['sessionID'] as String? ?? info['sessionId'] as String? ?? '',
      role: role == 'user' ? MessageRole.user : MessageRole.assistant,
      createdAt: DateTime.fromMillisecondsSinceEpoch(created),
      text: text,
      toolCalls: collected.tools,
      diffs: diffs,
      subtaskNotifications: collected.subtasks,
      reasoningParts: collected.reasoning,
    );
  }

  ToolCall? _openCodeTool(Map<String, dynamic> part) {
    final partId = part['id'] as String? ?? '';
    final callId =
        part['callID'] as String? ??
        part['callId'] as String? ??
        part['call_id'] as String? ??
        '';
    if (callId.isEmpty) return null;
    final stateInfo = part['state'] as Map<String, dynamic>? ?? const {};
    final metadataRaw = stateInfo['metadata'];
    return ToolCall(
      callId: callId,
      partId: partId.isNotEmpty ? partId : callId,
      name: part['tool'] as String? ?? 'tool',
      status: stateInfo['status'] as String? ?? 'completed',
      title: stateInfo['title'] as String?,
      input: stateInfo['input'] as Map<String, dynamic>? ?? const {},
      output: stateInfo['output'] as String?,
      metadata: metadataRaw is Map<String, dynamic>
          ? metadataRaw
          : const <String, dynamic>{},
    );
  }

  /// Puts an older page in front of the loaded window without re-hydrating it,
  /// so a message that streamed in while the page was in flight survives.
  void prependOpenCodeTranscript(
    List<Map<String, dynamic>> items, {
    required String sessionId,
  }) {
    if (!ownsTranscript(sessionId) || items.isEmpty) return;
    final additions = <ChatMessage>[];
    for (final item in items) {
      final message = openCodeTranscriptMessage(item);
      if (message == null || _messages.containsKey(message.id)) continue;
      additions.add(message);
    }
    _prependMessages(additions);
  }
}

/// What one message's parts add up to, in the shapes a [ChatMessage] holds.
final class _OcPartCollection {
  final StringBuffer text = StringBuffer();
  final List<ToolCall> tools = <ToolCall>[];
  final List<SubtaskNotification> subtasks = <SubtaskNotification>[];
  final List<ReasoningPart> reasoning = <ReasoningPart>[];

  void add(
    Map<String, dynamic> part,
    ToolCall? Function(Map<String, dynamic>) tool,
  ) {
    switch (part['type'] as String? ?? '') {
      case 'text':
        // OpenCode's own TUI drops synthetic and ignored text too.
        if (part['synthetic'] == true || part['ignored'] == true) return;
        text.write(part['text'] as String? ?? '');
      case 'tool':
        final call = tool(part);
        if (call != null) tools.add(call);
      case 'subtask':
        subtasks.add(SubtaskNotification.fromJson(part));
      case 'reasoning':
        reasoning.add(ReasoningPart.fromJson(part));
    }
  }
}
