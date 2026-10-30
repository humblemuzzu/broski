part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// Codex session setup, hydration, user input, and helpers.
/// Extracted from chat_provider.dart.
extension CxStreamHandler on ChatSessionNotifier {
  /// Reply to a Codex request_user_input (SDK v0.87.0+)
  /// [answers] is indexed by question position, matching the UI's output format.
  /// Protocol shape: { answers: { questionId: { answers: string[] } } }
  void replyToCodexUserInput(List<List<String>> answers) {
    final req = state.cxPendingUserInput;
    if (req == null || req.requestId.isEmpty) return;

    // Convert List<List<String>> to Map<questionId, {answers: [...]}>
    // Protocol: ToolRequestUserInputResponse = { answers: { [questionId]: ToolRequestUserInputAnswer } }
    // where ToolRequestUserInputAnswer = { answers: string[] }
    final answersMap = <String, Map<String, dynamic>>{};
    for (var i = 0; i < req.questions.length && i < answers.length; i++) {
      final questionId = req.questions[i].id;
      final selected = answers[i].where((s) => s.trim().isNotEmpty).toList();
      answersMap[questionId] = {'answers': selected};
    }

    _bridge.cxRespondToUserInput(requestId: req.requestId, answers: answersMap);
    _clearCxPendingUserInput();
  }

  /// Dismiss/reject a Codex request_user_input (SDK v0.87.0+)
  void rejectCodexUserInput() {
    final req = state.cxPendingUserInput;
    if (req == null || req.requestId.isEmpty) return;

    // Send empty answers to dismiss
    // Protocol: ToolRequestUserInputAnswer = { answers: string[] }
    final answersMap = <String, Map<String, dynamic>>{};
    for (final q in req.questions) {
      answersMap[q.id] = {'answers': <String>[]};
    }

    _bridge.cxRespondToUserInput(requestId: req.requestId, answers: answersMap);
    _clearCxPendingUserInput();
  }

  /// Helper to explicitly clear cxPendingUserInput.
  void _clearCxPendingUserInput() {
    if (state.cxPendingUserInput == null) return;
    state = state.copyWith(cxPendingUserInput: null);
  }

  void setCodexThread({
    required String threadId,
    required String cwd,
    String? model,
  }) {
    _messages.clear();
    _order.clear();
    _transcriptCursor = null;
    _transcriptSessionId = threadId;
    _rolesByMessageId.clear();
    _pendingLocalUserTextByMessageId.clear();
    _localAuthoredUserMessageIds.clear();
    _pendingTextBuffers.clear();
    _runtimeChatTurns.clear();
    _textDebounceTimer?.cancel();
    _textDebounceTimer = null;
    _runtimeProjectionTimer?.cancel();
    _runtimeProjectionTimer = null;
    _pendingProjectionTurn = null;
    _resetCCState();
    state = CodexChatState(
      projectPath: cwd,
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
      todos: const [],
      cxThreadId: threadId.isEmpty ? null : threadId,
      cxCwd: cwd,
      cxModel: model,
    );
    if (threadId.isNotEmpty) {
      _bridge.setView(sessionId: threadId, agent: 'codex');
    }
  }

  void setCodexModel(String? model) {
    if (!state.isCodex) return;
    state = state.copyWith(cxModel: model);
  }

  /// Hydrate chat with Codex transcript messages from the bridge.
  void hydrateCodexTranscript(List<CodexTranscriptMessage> items) {
    _messages.clear();
    _order.clear();

    state = state.copyWith(
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
      cxIsStreaming: false,
    );

    _suppressEmit = true;
    _pendingEmitMessages = false;

    try {
      for (final item in items) {
        if (item.id.isEmpty) continue;
        _addMessage(cxTranscriptMessage(item, state.cxThreadId ?? ''));
      }
    } finally {
      _suppressEmit = false;
      if (_pendingEmitMessages) {
        _emitMessages();
      }
    }
  }

  /// Set Codex streaming state (called when sending a message)
  void setCodexStreaming(bool isStreaming) {
    state = state.copyWith(cxIsStreaming: isStreaming);
  }

  // ============================================================
  // Codex Message Queue (queue for next turn)
  // ============================================================

  /// Queue a follow-up message for auto-send when the Codex turn completes.
  /// Unlike steer (mid-turn nudge), queued messages wait and send as a full
  /// new turn after the current one finishes.
  void queueCodexMessage(String message) {
    final current = state.cxQueuedMessages;
    state = state.copyWith(cxQueuedMessages: [...current, message]);
  }

  /// Cancel a specific queued message by index.
  void cancelQueuedCodexMessage(int index) {
    final current = [...state.cxQueuedMessages];
    if (index >= 0 && index < current.length) {
      current.removeAt(index);
      state = state.copyWith(cxQueuedMessages: current);
    }
  }

  /// Clear all queued Codex messages.
  void clearCodexQueue() {
    if (state.cxQueuedMessages.isEmpty) return;
    state = state.copyWith(cxQueuedMessages: const []);
  }

  // ============================================================
  // Shared Helpers (used by runtime_cx_handlers.dart)
  // ============================================================

  (int, int) _countUnifiedDiffAddsDels(String diff) {
    var adds = 0;
    var dels = 0;
    for (final line in diff.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) adds++;
      if (line.startsWith('-')) dels++;
    }
    return (adds, dels);
  }
}
