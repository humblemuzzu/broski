part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// Handles compaction and retry runtime events by creating system ChatMessages.
///
/// Extracted from runtime_chat_ingest.dart inline handling.
extension RuntimeSystemMessages on ChatSessionNotifier {
  void _handleRuntimeCompactionStarted(RuntimeCompactionStartedEvent event) {
    state = state.copyWith(isCompacting: true);
    final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';
    if (sessionId.isEmpty) return;
    final reason = event.reason;
    _addMessage(
      ChatMessage(
        id: '${event.backend.wireValue}-compaction-start-${event.timestampMs}',
        sessionId: sessionId,
        role: MessageRole.system,
        createdAt: DateTime.fromMillisecondsSinceEpoch(event.timestampMs),
        text: reason != null && reason.isNotEmpty
            ? 'Context compaction started: $reason'
            : 'Context compaction started',
        error: 'context_compacting',
      ),
    );
  }

  void _handleRuntimeCompactionFinished(RuntimeCompactionFinishedEvent event) {
    state = state.copyWith(isCompacting: false);
    final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';
    if (sessionId.isEmpty) return;
    final text = (event.aborted == true)
        ? 'Context compaction aborted${event.errorMessage != null ? ': ${event.errorMessage}' : ''}'
        : 'Context compacted';
    _addMessage(
      ChatMessage(
        id: '${event.backend.wireValue}-compaction-end-${event.timestampMs}',
        sessionId: sessionId,
        role: MessageRole.system,
        createdAt: DateTime.fromMillisecondsSinceEpoch(event.timestampMs),
        text: text,
        error: 'context_compacted',
      ),
    );
  }

  void _handleRuntimeRetryStarted(RuntimeRetryStartedEvent event) {
    final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';
    if (sessionId.isEmpty) return;
    final attempt = event.attempt ?? '?';
    final maxAttempts = event.maxAttempts;
    final label = maxAttempts != null
        ? 'Retrying (attempt $attempt/$maxAttempts)...'
        : 'Retrying (attempt $attempt)...';
    _addMessage(
      ChatMessage(
        id: '${event.backend.wireValue}-retry-start-${event.timestampMs}',
        sessionId: sessionId,
        role: MessageRole.system,
        createdAt: DateTime.fromMillisecondsSinceEpoch(event.timestampMs),
        text: label,
      ),
    );
  }

  void _handleRuntimeRetryFinished(RuntimeRetryFinishedEvent event) {
    final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';
    if (sessionId.isEmpty) return;
    final text = (event.success == true)
        ? 'Retry succeeded'
        : event.finalError != null
        ? 'Retry failed: ${event.finalError}'
        : 'Retry failed';
    _addMessage(
      ChatMessage(
        id: '${event.backend.wireValue}-retry-end-${event.timestampMs}',
        sessionId: sessionId,
        role: MessageRole.system,
        createdAt: DateTime.fromMillisecondsSinceEpoch(event.timestampMs),
        text: text,
      ),
    );
  }
}
