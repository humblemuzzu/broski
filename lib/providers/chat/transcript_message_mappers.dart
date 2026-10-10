part of '../chat_provider.dart';

/// Maps one Claude Code transcript item from the bridge to the chat message it renders as.
///
/// Shared by hydration and by prepending an older page, so both show the same message.
ChatMessage? ccTranscriptMessage(Map<String, dynamic> item, String sessionId) {
  final id = item['id'] as String? ?? '';
  if (id.isEmpty) return null;

  final role = item['role'] as String? ?? 'assistant';
  final createdAtMs = item['createdAt'] as int? ?? 0;
  final text = item['text'] as String? ?? '';
  final thinking = item['thinking'] as String?;
  final toolCallsRaw = item['toolCalls'];
  final diffsRaw = item['diffs'];

  final reasoningParts = <ReasoningPart>[];
  if (thinking != null && thinking.trim().isNotEmpty) {
    reasoningParts.add(
      ReasoningPart(
        id: 'cc-thinking-$id',
        messageId: id,
        text: thinking,
        isStreaming: false,
      ),
    );
  }

  final tools = <ToolCall>[];
  if (toolCallsRaw is List) {
    for (final t in toolCallsRaw) {
      if (t is! Map<String, dynamic>) continue;
      final toolUseId = t['toolUseId'] as String? ?? '';
      if (toolUseId.isEmpty) continue;
      final toolName = t['tool'] as String? ?? 'tool';
      final input = t['input'];
      final status = t['status'] as String? ?? 'completed';
      final output = t['output'] as String?;
      final metaRaw = t['metadata'];
      final metadata = metaRaw is Map<String, dynamic>
          ? metaRaw
          : const <String, dynamic>{};

      tools.add(
        ToolCall(
          callId: toolUseId,
          partId: toolUseId,
          name: toolName,
          status: status,
          title: toolName,
          input: input is Map<String, dynamic>
              ? input
              : {'input': input?.toString() ?? ''},
          output: output,
          metadata: metadata,
        ),
      );
    }
  }

  final diffs = <DiffEntry>[];
  if (diffsRaw is List) {
    for (final d in diffsRaw) {
      if (d is! Map<String, dynamic>) continue;
      final file = d['file'] as String? ?? '';
      if (file.isEmpty) continue;
      diffs.add(
        DiffEntry(
          file: file,
          before: d['before'] as String? ?? '',
          after: d['after'] as String? ?? '',
          additions: d['additions'] as int? ?? 0,
          deletions: d['deletions'] as int? ?? 0,
          diff: d['diff'] as String?,
          partId: d['partId'] as String?,
          status: d['status'] as String?,
        ),
      );
    }
  }

  return ChatMessage(
    id: id,
    sessionId: sessionId,
    role: switch (role) {
      'user' => MessageRole.user,
      'assistant' => MessageRole.assistant,
      _ => MessageRole.system,
    },
    createdAt: DateTime.fromMillisecondsSinceEpoch(createdAtMs),
    text: text,
    toolCalls: tools,
    diffs: diffs,
    reasoningParts: reasoningParts,
    isStreaming: false,
  );
}

/// Maps one Codex transcript item from the bridge to the chat message it renders as.
ChatMessage cxTranscriptMessage(CodexTranscriptMessage item, String threadId) {
  final id = item.id;
  final role = switch (item.role) {
    'user' => MessageRole.user,
    'system' => MessageRole.system,
    _ => MessageRole.assistant,
  };

  final reasoningParts = <ReasoningPart>[];
  if ((item.thinking ?? '').trim().isNotEmpty) {
    reasoningParts.add(
      ReasoningPart(
        id: 'cx-thinking-$id',
        messageId: id,
        text: item.thinking ?? '',
        isStreaming: false,
      ),
    );
  }

  final tools = <ToolCall>[
    for (final t in item.toolCalls)
      ToolCall(
        callId: t.itemId,
        partId: t.itemId,
        name: t.name,
        status: t.status,
        title: t.name,
        input: t.input ?? const <String, dynamic>{},
        output: t.output,
        metadata: t.metadata ?? const <String, dynamic>{},
      ),
  ];

  final diffs = <DiffEntry>[
    for (final d in item.diffs)
      DiffEntry(
        file: d.file,
        before: '',
        after: '',
        additions: d.additions,
        deletions: d.deletions,
        diff: d.diff,
        partId: d.itemId,
      ),
  ];

  return ChatMessage(
    id: id,
    sessionId: threadId,
    role: role,
    createdAt: DateTime.fromMillisecondsSinceEpoch(item.createdAt * 1000),
    text: item.text,
    toolCalls: tools,
    diffs: diffs,
    reasoningParts: reasoningParts,
    isStreaming: false,
  );
}
