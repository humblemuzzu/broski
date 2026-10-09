part of '../chat_provider.dart';

/// Optimistic Pi `!` shell-command cards in the transcript.
extension PiBashMessages on ChatSessionNotifier {
  String appendPiBashCommand({
    required String command,
    required bool excludeFromContext,
    required String sessionId,
  }) {
    final id = 'pi-bash-${DateTime.now().microsecondsSinceEpoch}';
    _addMessage(
      ChatMessage(
        id: id,
        sessionId: sessionId,
        role: MessageRole.user,
        createdAt: DateTime.now(),
        text: command,
        metadata: piBashRunningMetadata(
          command: command,
          excludeFromContext: excludeFromContext,
        ),
      ),
    );
    return id;
  }

  void completePiBashCommand({
    required String messageId,
    required PiBashResult result,
  }) {
    _finalizePiBashCommand(
      messageId: messageId,
      output: result.output,
      exitCode: result.exitCode,
      cancelled: result.cancelled,
      truncated: result.truncated,
      error: result.error,
    );
  }

  void failPiBashCommand({required String messageId, required String error}) {
    _finalizePiBashCommand(messageId: messageId, output: '', error: error);
  }

  void _finalizePiBashCommand({
    required String messageId,
    required String output,
    int? exitCode,
    bool cancelled = false,
    bool truncated = false,
    String? error,
  }) {
    final existing = _messages[messageId];
    if (existing == null) return;
    _updateMessage(
      messageId,
      existing.copyWith(
        metadata: piBashFinishedMetadata(
          command: existing.text,
          excludeFromContext:
              existing.metadata[PiBashCardKeys.excludeFromContext] as bool? ??
              false,
          output: output,
          exitCode: exitCode,
          cancelled: cancelled,
          truncated: truncated,
          error: error,
        ),
      ),
    );
  }
}

/// Builds a finished card from a `bashExecution` entry returned on transcript
/// reload, so `!` commands survive a re-hydrate instead of only living in the
/// optimistic message.
ChatMessage? piBashTranscriptCard({
  required Map<String, dynamic> item,
  required String id,
  required String sessionId,
}) {
  final command = item['command'] as String? ?? '';
  if (command.isEmpty) return null;
  return ChatMessage(
    id: id,
    sessionId: sessionId,
    role: MessageRole.user,
    createdAt: DateTime.fromMillisecondsSinceEpoch(
      (item['timestamp'] as num?)?.toInt() ??
          DateTime.now().millisecondsSinceEpoch,
    ),
    text: command,
    metadata: piBashTranscriptMetadata(item),
  );
}
