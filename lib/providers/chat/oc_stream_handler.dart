part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// OpenCode session setup, hydration, and helpers.
/// Extracted from chat_provider.dart.
extension OcStreamHandler on ChatSessionNotifier {
  void setSession(SessionSummary session, {String? projectPath}) {
    _messages.clear();
    _order.clear();
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
      final map = item as Map<String, dynamic>;
      final info = map['info'] as Map<String, dynamic>? ?? const {};
      final parts = map['parts'] as List<dynamic>? ?? const [];
      final messageId = info['id'] as String? ?? '';
      final sessionId =
          info['sessionID'] as String? ?? info['sessionId'] as String? ?? '';
      final role = info['role'] as String? ?? 'assistant';
      final created =
          info['time']?['created'] as int? ??
          DateTime.now().millisecondsSinceEpoch;

      if (messageId.isEmpty) continue;

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
          final partId = part['id'] as String? ?? '';
          final callId =
              part['callID'] as String? ??
              part['callId'] as String? ??
              part['call_id'] as String? ??
              '';
          final toolName = part['tool'] as String? ?? 'tool';
          final stateInfo = part['state'] as Map<String, dynamic>? ?? const {};
          final status = stateInfo['status'] as String? ?? 'completed';
          final title = stateInfo['title'] as String?;
          final input = stateInfo['input'] as Map<String, dynamic>? ?? const {};
          final output = stateInfo['output'] as String?;
          final metadataRaw = stateInfo['metadata'];
          final metadata = metadataRaw is Map<String, dynamic>
              ? metadataRaw
              : const <String, dynamic>{};
          if (callId.isNotEmpty) {
            final tool = ToolCall(
              callId: callId,
              partId: partId.isNotEmpty ? partId : callId,
              name: toolName,
              status: status,
              title: title,
              input: input,
              output: output,
              metadata: metadata,
            );
            tools.add(tool);

            final diff = _extractDiffFromTool(tool);
            if (diff != null) {
              diffs.add(diff);
            }
          }
        }
        // Parse subtask notifications (background task completions)
        if (partType == 'subtask') {
          subtasks.add(SubtaskNotification.fromJson(part));
        }
        // Parse reasoning parts (model thinking content)
        if (partType == 'reasoning') {
          reasoningParts.add(ReasoningPart.fromJson(part));
        }
      }

      final textContent = textBuffer.toString();

      // Skip user messages that have no visible content after filtering synthetic parts
      // (these are system-injected context messages, not real user input)
      if (role == 'user' && textContent.isEmpty && tools.isEmpty) {
        continue;
      }

      final message = ChatMessage(
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

      _addMessage(message);
    }
  }
}
