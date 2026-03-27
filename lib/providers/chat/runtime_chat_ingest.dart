part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// Core runtime chat ingest — event/state routing, projection, matching.
extension _RuntimeChatIngest on ChatSessionNotifier {
  void _initializeRuntimeChatIngest() {
    _runtimeEventSubscription = _bridge.runtimeEvents.listen(
      _handleRuntimeChatEvent,
      onError: _handleRuntimeChatStreamError,
    );
    _runtimeStateSubscription = _bridge.runtimeStates.listen(
      _handleRuntimeChatState,
      onError: _handleRuntimeChatStreamError,
    );
  }

  void _handleRuntimeChatEvent(RuntimeEvent event) {
    if (!_runtimeMatchesActiveChat(
      backend: event.backend,
      sessionId: event.sessionId,
      cwd: event.cwd,
    )) {
      return;
    }

    final sessionKey = buildRuntimeChatSessionKey(
      backend: event.backend,
      sessionId: event.sessionId,
      cwd: event.cwd,
    );
    final current = _runtimeChatTurns[sessionKey];
    final fingerprint = runtimeChatEventFingerprint(event);
    if (current?.recentEventFingerprints.contains(fingerprint) == true) {
      return;
    }

    final next = reduceRuntimeChatEvent(
      current,
      event,
      metadataForEvent: _runtimeToolMetadataForEvent,
    );
    _runtimeChatTurns[sessionKey] = next;

    _applyRuntimeStateToChat(event.backend, runtimeState: null, turn: next);
    _projectRuntimeTurn(next);

    if (event case RuntimeErrorEvent()) {
      _addRuntimeErrorMessage(event);
    }

    // Handle compaction/retry system messages (runtime_system_messages.dart)
    if (event case RuntimeCompactionStartedEvent()) {
      _handleRuntimeCompactionStarted(event);
    }
    if (event case RuntimeCompactionFinishedEvent()) {
      _handleRuntimeCompactionFinished(event);
    }
    if (event case RuntimeRetryStartedEvent()) {
      _handleRuntimeRetryStarted(event);
    }
    if (event case RuntimeRetryFinishedEvent()) {
      _handleRuntimeRetryFinished(event);
    }

    // Permission/approval requests via runtime (runtime_permission_handler.dart)
    if (event case RuntimePermissionRequestedEvent()) {
      _handleRuntimePermissionRequested(event);
    }

    if (event case RuntimeUserInputRequestedEvent()) {
      _handleRuntimeUserInputRequested(event);
    }

    // CC system notification messages (runtime_cc_system_messages.dart)
    if (event case RuntimeBackendEvent()
        when event.backend == AgentType.claudeCode) {
      _handleRuntimeCcBackendEvent(event);
    }

    // CC metadata enrichment (runtime_cc_metadata_handler.dart)
    if (event.backend == AgentType.claudeCode) {
      if (event case RuntimeAgentStartedEvent()) {
        _handleRuntimeCcAgentStarted(event);
      }
      if (event case RuntimeAgentFinishedEvent()) {
        _handleRuntimeCcAgentFinished(event);
      }
      if (event case RuntimeToolStartedEvent()) {
        _handleRuntimeCcToolStarted(event);
      }
      if (event case RuntimeToolFinishedEvent()) {
        _handleRuntimeCcToolFinished(event);
      }
    }

    // OC message lifecycle + metadata (runtime_oc_message_handler.dart)
    if (event case RuntimeBackendEvent()
        when event.backend == AgentType.opencode) {
      _handleRuntimeOcBackendEvent(event);
    }

    // CX metadata + collab (runtime_cx_handlers.dart)
    if (event case RuntimeBackendEvent()
        when event.backend == AgentType.codex) {
      _handleRuntimeCxBackendEvent(event);
    }
  }

  void _handleRuntimeChatState(RuntimeState runtimeState) {
    if (!_runtimeMatchesActiveChat(
      backend: runtimeState.backend,
      sessionId: runtimeState.sessionId,
      cwd: runtimeState.cwd,
    )) {
      return;
    }

    final sessionKey = buildRuntimeChatSessionKey(
      backend: runtimeState.backend,
      sessionId: runtimeState.sessionId,
      cwd: runtimeState.cwd,
    );
    final next = reduceRuntimeChatState(
      _runtimeChatTurns[sessionKey],
      runtimeState,
    );
    _runtimeChatTurns[sessionKey] = next;

    _applyRuntimeStateToChat(
      runtimeState.backend,
      runtimeState: runtimeState,
      turn: next,
    );
    _projectRuntimeTurn(next);
  }

  void _projectRuntimeTurn(RuntimeChatTurnState turn) {
    final messageId = turn.messageId;
    if (messageId == null || messageId.isEmpty) return;

    final existing = _messages[messageId];
    final diffs = <DiffEntry>[];
    for (final tool in turn.tools.values) {
      diffs.addAll(_mergeToolDiffs(diffs, tool: tool).skip(diffs.length));
    }

    final message = buildRuntimeChatMessage(
      turn,
      createdAt: existing?.createdAt ?? DateTime.now(),
      diffs: diffs,
    );
    if (message == null) return;

    if (existing == null) {
      _addMessage(message);
    } else {
      _updateMessage(message.id, message);
    }
  }

  bool _runtimeMatchesActiveChat({
    required AgentType backend,
    String? sessionId,
    String? cwd,
  }) {
    final activeBackend = state.isClaudeCode
        ? AgentType.claudeCode
        : state.isCodex
        ? AgentType.codex
        : state.isPi
        ? AgentType.pi
        : AgentType.opencode;
    if (backend != activeBackend) return false;

    final activeSessionId = (state.effectiveSessionId ?? '').trim();
    final eventSessionId = (sessionId ?? '').trim();
    if (activeSessionId.isNotEmpty && eventSessionId.isNotEmpty) {
      return activeSessionId == eventSessionId;
    }

    final activeCwd = (state.effectivePath ?? '').trim();
    final eventCwd = (cwd ?? '').trim();
    if (activeCwd.isNotEmpty && eventCwd.isNotEmpty) {
      return activeCwd == eventCwd;
    }

    return activeSessionId.isEmpty && activeCwd.isEmpty;
  }

  void _applyRuntimeStateToChat(
    AgentType backend, {
    required RuntimeState? runtimeState,
    required RuntimeChatTurnState turn,
  }) {
    final sessionStatus = _runtimeSessionStatus(runtimeState, turn);
    switch (backend) {
      case AgentType.opencode:
        state = state.copyWith(
          sessionStatus: sessionStatus,
          isCompacting: runtimeState?.isCompacting ?? state.isCompacting,
        );
        break;
      case AgentType.claudeCode:
        state = state.copyWith(
          sessionStatus: sessionStatus,
          ccSessionId: (state.ccSessionId ?? '').isEmpty
              ? turn.sessionId
              : state.ccSessionId,
          ccCwd: (state.ccCwd ?? '').isEmpty ? turn.cwd : state.ccCwd,
          ccModel: runtimeState?.model?.id ?? state.ccModel,
          ccIsStreaming: turn.isStreaming,
          isCompacting: runtimeState?.isCompacting ?? state.isCompacting,
        );
        break;
      case AgentType.codex:
        state = state.copyWith(
          sessionStatus: sessionStatus,
          cxThreadId: (state.cxThreadId ?? '').isEmpty
              ? turn.sessionId
              : state.cxThreadId,
          cxCwd: (state.cxCwd ?? '').isEmpty ? turn.cwd : state.cxCwd,
          cxModel: runtimeState?.model?.id ?? state.cxModel,
          cxIsStreaming: turn.isStreaming,
          isCompacting: runtimeState?.isCompacting ?? state.isCompacting,
        );
        break;
      case AgentType.pi:
        state = state.copyWith(
          sessionStatus: sessionStatus,
          piSessionId: (state.piSessionId ?? '').isEmpty
              ? turn.sessionId
              : state.piSessionId,
          piCwd: (state.piCwd ?? '').isEmpty ? turn.cwd : state.piCwd,
          piModel: runtimeState?.model?.id ?? state.piModel,
          piIsStreaming: turn.isStreaming,
          isCompacting: runtimeState?.isCompacting ?? state.isCompacting,
        );
        break;
    }
  }

  SessionStatus _runtimeSessionStatus(
    RuntimeState? runtimeState,
    RuntimeChatTurnState turn,
  ) {
    if (runtimeState?.backendData case final Map<String, dynamic> backendData) {
      final rawStatus = backendData['status'];
      if (rawStatus is Map<String, dynamic>) {
        return SessionStatus.fromJson(rawStatus);
      }
      if (rawStatus is Map) {
        return SessionStatus.fromJson(rawStatus.cast<String, dynamic>());
      }
    }

    if (runtimeState?.isRetrying == true) {
      return const SessionStatus.retry(attempt: 0, message: '', next: 0);
    }
    return turn.isStreaming
        ? const SessionStatus.busy()
        : const SessionStatus.idle();
  }

  Map<String, dynamic> _runtimeToolMetadataForEvent(RuntimeEvent event) {
    final metadata = <String, dynamic>{};
    final backendData = event.backendData;
    if (backendData != null && backendData.isNotEmpty) {
      metadata['runtimeBackendData'] = backendData;
    }

    switch (event) {
      case RuntimeToolStartedEvent():
      case RuntimeToolUpdatedEvent():
      case RuntimeToolFinishedEvent():
        if (event.backend == AgentType.claudeCode) {
          final toolUseResult = backendData?['toolUseResult'];
          metadata.addAll(
            _ccMetadataFromToolUseResult(_runtimeMap(toolUseResult)),
          );
        }
        if (event.backend == AgentType.opencode) {
          final rawMetadata = backendData?['metadata'];
          if (rawMetadata is Map<String, dynamic>) {
            metadata.addAll(rawMetadata);
          } else if (rawMetadata is Map) {
            metadata.addAll(rawMetadata.cast<String, dynamic>());
          }
        }
        if (event.backend == AgentType.codex) {
          _appendCodexRuntimeDiffMetadata(metadata, event);
        }
        if (event.backend == AgentType.pi) {
          final details = backendData?['details'];
          final detailsMap = _runtimeMap(details);
          final diff = detailsMap?['diff'] as String?;
          if (diff != null && diff.isNotEmpty) {
            metadata['diff'] = diff;
          }
        }
        break;
      default:
        break;
    }

    return metadata;
  }

  void _appendCodexRuntimeDiffMetadata(
    Map<String, dynamic> metadata,
    RuntimeEvent event,
  ) {
    final input = switch (event) {
      RuntimeToolStartedEvent() => event.input,
      RuntimeToolUpdatedEvent() => event.input,
      RuntimeToolFinishedEvent() => event.input,
      _ => null,
    };
    final inputMap = _runtimeMap(input);
    final changes = inputMap?['changes'];
    if (changes is! List || changes.isEmpty) return;
    final first = _runtimeMap(changes.first);
    if (first == null) return;
    final path = first['path'] as String?;
    final diff = first['diff'] as String?;
    if ((path ?? '').isEmpty || (diff ?? '').isEmpty) return;
    metadata['filediff'] = {'file': path, 'path': path, 'diff': diff};
    metadata['diff'] = diff;
  }

  void _addRuntimeErrorMessage(RuntimeErrorEvent event) {
    final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';
    if (sessionId.isEmpty) return;
    final message = ChatMessage(
      id: 'runtime-error-${event.backend.wireValue}-${event.timestampMs}',
      sessionId: sessionId,
      role: MessageRole.system,
      createdAt: DateTime.fromMillisecondsSinceEpoch(event.timestampMs),
      text: _runtimeErrorDisplayText(event),
      error: event.code ?? 'runtime_error',
    );
    if (_messages.containsKey(message.id)) return;
    _addMessage(message);
  }

  String _runtimeErrorDisplayText(RuntimeErrorEvent event) {
    if (event.backend == AgentType.claudeCode &&
        event.code == 'assistant_error') {
      return switch (event.message) {
        'authentication_failed' =>
          '🔒 Authentication failed - check your API key',
        'billing_error' => '💳 Billing error - check your account',
        'rate_limit' => '⏱ Rate limited - please wait a moment',
        'max_output_tokens' =>
          '📏 Response truncated - max output tokens reached',
        'server_error' => '🔥 Server error - please retry',
        'invalid_request' => '⚠️ Invalid request',
        _ => '⚠️ Error: ${event.message}',
      };
    }

    if (event.backend == AgentType.opencode) {
      final details = _runtimeMap(event.details);
      final errorName = details?['name'] as String?;
      final errorData = _runtimeMap(details?['data']);
      final rawMessage = errorData?['message'] as String? ?? event.message;
      return switch (errorName) {
        'ContextOverflowError' =>
          'Context window full. Try compacting or starting a new session.',
        'StructuredOutputError' =>
          'Output validation failed after ${(errorData?['retries'] as int?) ?? 0} retries',
        'MessageOutputLengthError' =>
          'Response too long - output was truncated',
        _ => rawMessage,
      };
    }

    return event.message;
  }

  void _handleRuntimeChatStreamError(Object error, StackTrace stackTrace) {
    developer.log(
      'Runtime chat stream error: $error',
      name: 'ChatProvider',
      error: error,
      stackTrace: stackTrace,
    );
  }

  Map<String, dynamic>? _runtimeMap(Object? value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return value.cast<String, dynamic>();
    return null;
  }

  RuntimeChatTurnState? _runtimeActiveTurn(AgentType backend) {
    final sessionKey = buildRuntimeChatSessionKey(
      backend: backend,
      sessionId: state.effectiveSessionId,
      cwd: state.effectivePath,
    );
    return _runtimeChatTurns[sessionKey];
  }

  void _replaceRuntimeTool(
    AgentType backend,
    String callId,
    ToolCall Function(ToolCall current) transform,
  ) {
    final turn = _runtimeActiveTurn(backend);
    if (turn == null) return;
    final current = turn.tools[callId];
    if (current == null) return;
    final updated = transform(current);
    final next = turn.copyWith(tools: {...turn.tools, callId: updated});
    _runtimeChatTurns[turn.sessionKey] = next;
    _projectRuntimeTurn(next);
  }
}
