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
    _rolesByMessageId.clear();
    _pendingLocalUserTextByMessageId.clear();
    _localAuthoredUserMessageIds.clear();
    _pendingTextBuffers.clear();
    _runtimeChatTurns.clear();
    _textDebounceTimer?.cancel();
    _textDebounceTimer = null;
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
        final id = item.id;
        if (id.isEmpty) continue;

        final role = switch (item.role) {
          'user' => MessageRole.user,
          'system' => MessageRole.system,
          _ => MessageRole.assistant,
        };

        final createdAt = DateTime.fromMillisecondsSinceEpoch(
          item.createdAt * 1000,
        );

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

        final message = ChatMessage(
          id: id,
          sessionId: state.cxThreadId ?? '',
          role: role,
          createdAt: createdAt,
          text: item.text,
          toolCalls: tools,
          diffs: diffs,
          reasoningParts: reasoningParts,
          isStreaming: false,
        );

        _addMessage(message);
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
