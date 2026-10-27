part of '../chat_provider.dart';

/// OpenCode messages from the wire, and an older page of them in front of the
/// loaded window.
extension OcTranscriptPage on ChatSessionNotifier {
  /// One message of an OpenCode transcript, or null when the entry carries no
  /// visible content.
  ChatMessage? openCodeTranscriptMessage(Map<String, dynamic> item) {
    final info = item['info'] as Map<String, dynamic>? ?? const {};
    final parts = item['parts'] as List<dynamic>? ?? const [];
    final messageId = info['id'] as String? ?? '';
    if (messageId.isEmpty) return null;

    final sessionId =
        info['sessionID'] as String? ?? info['sessionId'] as String? ?? '';
    final role = info['role'] as String? ?? 'assistant';
    final created =
        info['time']?['created'] as int? ??
        DateTime.now().millisecondsSinceEpoch;

    var textBuffer = StringBuffer();
    final tools = <ToolCall>[];
    final diffs = <DiffEntry>[];
    final subtasks = <SubtaskNotification>[];
    final reasoningParts = <ReasoningPart>[];

    for (final partItem in parts) {
      final part = partItem as Map<String, dynamic>;
      final partType = part['type'] as String? ?? '';
      if (partType == 'text') {
        // Skip synthetic and ignored text parts (system-injected content)
        // OpenCode TUI does the same filtering
        final isSynthetic = part['synthetic'] as bool? ?? false;
        final isIgnored = part['ignored'] as bool? ?? false;
        if (!isSynthetic && !isIgnored) {
          textBuffer.write(part['text'] as String? ?? '');
        }
      }
      if (partType == 'tool') {
        final tool = _openCodeTool(part);
        if (tool != null) {
          tools.add(tool);
          final diff = _extractDiffFromTool(tool);
          if (diff != null) {
            diffs.add(diff);
          }
        }
      }
      if (partType == 'subtask') {
        subtasks.add(SubtaskNotification.fromJson(part));
      }
      if (partType == 'reasoning') {
        reasoningParts.add(ReasoningPart.fromJson(part));
      }
    }

    final textContent = textBuffer.toString();

    // Skip user messages that have no visible content after filtering synthetic parts
    // (these are system-injected context messages, not real user input)
    if (role == 'user' && textContent.isEmpty && tools.isEmpty) {
      return null;
    }

    return ChatMessage(
      id: messageId,
      sessionId: sessionId,
      role: role == 'user' ? MessageRole.user : MessageRole.assistant,
      createdAt: DateTime.fromMillisecondsSinceEpoch(created),
      text: textContent,
      toolCalls: tools,
      diffs: diffs,
      subtaskNotifications: subtasks,
      reasoningParts: reasoningParts,
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
