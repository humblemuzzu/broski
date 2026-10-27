part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// OpenCode session setup, hydration, and helpers.
/// Extracted from chat_provider.dart.
extension OcStreamHandler on ChatSessionNotifier {
  void setSession(SessionSummary session, {String? projectPath}) {
    _messages.clear();
    _order.clear();
    _transcriptCursor = null;
    _transcriptPageSeq = 0;
    _rolesByMessageId.clear();
    _pendingLocalUserTextByMessageId.clear();
    _localAuthoredUserMessageIds.clear();
    _pendingTextBuffers.clear(); // FIX: Clear text buffers for old session
    _runtimeChatTurns.clear();
    _textDebounceTimer?.cancel();
    _textDebounceTimer = null;
    _runtimeProjectionTimer?.cancel();
    _runtimeProjectionTimer = null;
    _pendingProjectionTurn = null;
    _resetCCState();
    state = OpenCodeChatState(session: session, projectPath: projectPath);
  }

  /// Set OpenCode agent mode ("build" or "plan")
  /// Used for manual toggling from UI or when plan_enter/plan_exit tools complete
  void setOCAgentMode(String mode) {
    if (state.isClaudeCode || state.isCodex) return;
    final validMode = (mode == 'plan') ? 'plan' : 'build';
    state = state.copyWith(ocAgentMode: validMode);
  }

  /// Rehydrate pending OpenCode permission/question prompts after reconnect.
  /// This prevents sessions from getting stuck if events were missed.
  Future<void> rehydrateOpenCodePending({required String projectPath}) async {
    final sessionId = state.session?.id;
    if (sessionId == null || sessionId.isEmpty) return;

    try {
      final pendingPerms = await _bridge.listPendingPermissions(
        projectPath: projectPath,
      );

      final existingIds = state.permissions.map((p) => p.id).toSet();
      final nextPerms = <PermissionRequest>[...state.permissions];

      for (final item in pendingPerms) {
        final sid =
            (item['sessionID'] as String?) ??
            (item['sessionId'] as String?) ??
            '';
        if (sid != sessionId) continue;

        final id = item['id'] as String? ?? '';
        if (id.isEmpty || existingIds.contains(id)) continue;

        final toolData = item['tool'] as Map<String, dynamic>?;
        final tool = toolData != null ? ToolReference.fromJson(toolData) : null;

        final patterns =
            (item['patterns'] as List<dynamic>?)
                ?.map((e) => e.toString())
                .toList() ??
            const <String>[];
        final always =
            (item['always'] as List<dynamic>?)
                ?.map((e) => e.toString())
                .toList() ??
            const <String>[];

        nextPerms.add(
          PermissionRequest(
            id: id,
            sessionId: sid,
            title: item['title'] as String? ?? 'Permission required',
            permission: item['permission'] as String?,
            patterns: patterns,
            always: always,
            tool: tool,
            command:
                (item['metadata'] as Map<String, dynamic>?)?['command']
                    as String?,
            metadata: item['metadata'] as Map<String, dynamic>? ?? const {},
          ),
        );
        existingIds.add(id);
      }

      if (nextPerms.length != state.permissions.length) {
        state = state.copyWith(permissions: nextPerms);
      }
    } catch (_) {
      // Best-effort only.
    }

    try {
      final pendingQs = await _bridge.listPendingQuestions(
        projectPath: projectPath,
      );
      if (state.pendingQuestion != null) return;

      for (final item in pendingQs) {
        final req = QuestionRequest.fromJson(item);
        if (req.id.isEmpty) continue;
        if (req.sessionId != sessionId) continue;

        state = state.copyWith(pendingQuestion: req);
        break;
      }
    } catch (_) {
      // Best-effort only.
    }
  }

  void hydrate(List<dynamic> rawMessages) {
    _messages.clear();
    _order.clear();
    state = state.copyWith(
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
    );

    for (final item in rawMessages) {
      if (item is! Map<String, dynamic>) continue;
      final message = openCodeTranscriptMessage(item);
      if (message != null) {
        _addMessage(message);
      }
    }
  }
}
