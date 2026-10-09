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

    final detectedGap = _runtimeEventHasGap(current, event);
    if (detectedGap) {
      _requestRuntimeGapRecovery(sessionKey, current, event);
    }

    final reduced = reduceRuntimeChatEvent(
      current,
      event,
      metadataForEvent: _runtimeToolMetadataForEvent,
    );
    final next = _rememberRuntimeEventProgress(
      reduced,
      event,
      detectedGap: detectedGap,
    );
    _runtimeChatTurns[sessionKey] = next;

    _applyRuntimeStateToChat(event.backend, runtimeState: null, turn: next);
    _scheduleRuntimeTurnProjection(next);

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

    // Confirm delivery of pending user messages when any agent starts
    if (event case RuntimeAgentStartedEvent()) {
      _confirmPendingMessages();
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

    if (event case RuntimeBackendEvent()
        when event.backend == AgentType.piDurable) {
      _handlePiDurableBackendEvent(event);
    }

    // External user message — prompt typed on Mac terminal, show it on phone
    if (event case RuntimeBackendEvent()
        when event.kind == 'external-user-message') {
      // Dedup by content hash + timestamp bucket (16-second window)
      final payload = event.payload;
      final extContent = payload is Map
          ? (payload['content'] ?? '').toString()
          : '';
      final bucket = event.timestampMs ~/ 16000;
      final dedupKey = '${extContent.hashCode}:$bucket';
      if (_seenExternalUserMessages.contains(dedupKey)) return;
      _seenExternalUserMessages.add(dedupKey);
      // Prevent unbounded growth
      if (_seenExternalUserMessages.length > 200) {
        _seenExternalUserMessages.clear();
      }
      _handleExternalUserMessage(event);
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
    _scheduleRuntimeTurnProjection(next);
  }

  void _scheduleRuntimeTurnProjection(RuntimeChatTurnState turn) {
    // If we have a pending turn with a DIFFERENT messageId, flush it NOW
    // before it gets overwritten. At turn boundaries _beginRuntimeTurn resets
    // the state (new messageId, empty text/tools), so if we don't flush the
    // old turn immediately its accumulated content is lost forever.
    final pending = _pendingProjectionTurn;
    if (pending != null &&
        pending.messageId != null &&
        pending.messageId != turn.messageId &&
        pending.hasVisibleContent) {
      _projectRuntimeTurn(pending);
    }

    _pendingProjectionTurn = turn;
    _runtimeProjectionTimer ??= Timer(const Duration(milliseconds: 16), () {
      _runtimeProjectionTimer = null;
      final p = _pendingProjectionTurn;
      if (p != null) {
        _pendingProjectionTurn = null;
        _projectRuntimeTurn(p);
      }
    });
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
        : state.isPiDurable
        ? AgentType.piDurable
        : AgentType.opencode;
    if (backend != activeBackend) return false;

    // Backend matches — accept. Session/cwd filtering caused silent event
    // drops for CC/CX/Pi where session ID formats differ between the bridge
    // connector and the Flutter state (e.g. Pi connector sessionId vs the
    // session list id). On single-device, if you're viewing a backend,
    // events from that backend are for you.
    return true;
  }

  bool _runtimeEventHasGap(RuntimeChatTurnState? current, RuntimeEvent event) {
    if (event.replayed) return false;
    final seq = event.seq;
    final previous = current?.lastEventSeq;
    if (seq == null || seq <= 0 || previous == null || previous <= 0) {
      return false;
    }
    return seq > previous + 1;
  }

  RuntimeChatTurnState _rememberRuntimeEventProgress(
    RuntimeChatTurnState turn,
    RuntimeEvent event, {
    required bool detectedGap,
  }) {
    final seq = event.seq;
    final nextSeq = switch (seq) {
      int value when value > 0 =>
        turn.lastEventSeq == null || value > turn.lastEventSeq!
            ? value
            : turn.lastEventSeq,
      _ => turn.lastEventSeq,
    };
    return turn.copyWith(
      lastEventSeq: nextSeq,
      lastGapAtMs: detectedGap
          ? DateTime.now().millisecondsSinceEpoch
          : turn.lastGapAtMs,
    );
  }

  void _requestRuntimeGapRecovery(
    String sessionKey,
    RuntimeChatTurnState? current,
    RuntimeEvent event,
  ) {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final lastGapAtMs = current?.lastGapAtMs;
    if (lastGapAtMs != null && nowMs - lastGapAtMs < 1500) {
      return;
    }
    developer.log(
      'Runtime event gap detected for $sessionKey: last=${current?.lastEventSeq}, next=${event.seq}',
      name: 'ChatProvider',
    );
    _bridge.setView(
      sessionId: event.sessionId,
      projectPath: event.cwd,
      agent: event.backend.wireValue,
      lastRuntimeSeq: current?.lastEventSeq,
    );
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
      case AgentType.piDurable:
        applyPiDurableRuntimeState(runtimeState: runtimeState, turn: turn);
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
            // Accumulate Pi file diffs into sessionDiffs for sidebar
            if (event is RuntimeToolFinishedEvent) {
              _accumulatePiSessionDiff(diff, event, backendData);
            }
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

  /// Accumulate a Pi file diff into sessionDiffs (sidebar Changes section).
  /// Pi edit tool results include a unified diff in details.diff.
  void _accumulatePiSessionDiff(
    String diff,
    RuntimeToolFinishedEvent event,
    Map<String, dynamic>? backendData,
  ) {
    // Parse file path. Pi's diff may not have standard "--- a/path" headers.
    String file = '';
    final headerMatch = RegExp(
      r'^[-+]{3} [ab]/(.+)$',
      multiLine: true,
    ).firstMatch(diff);
    if (headerMatch != null) {
      file = headerMatch.group(1) ?? '';
    }
    // Fallback: try tool input for file path
    if (file.isEmpty) {
      final input = event.input;
      if (input is Map<String, dynamic>) {
        file = (input['path'] as String?) ?? '';
      }
    }
    // Fallback: try tool output text ("replaced N block(s) in <path>")
    if (file.isEmpty) {
      final output = event.output?.toString() ?? '';
      final inMatch = RegExp(r'\bin\s+(\S+?)\.?$').firstMatch(output);
      if (inMatch != null) {
        file = inMatch.group(1) ?? '';
      }
    }
    if (file.isEmpty) file = 'unknown';

    // Count additions/deletions from unified diff
    int additions = 0;
    int deletions = 0;
    for (final line in diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }

    final entry = DiffEntry(
      file: file,
      before: '',
      after: '',
      additions: additions,
      deletions: deletions,
      diff: diff,
      partId: event.toolCallId,
    );

    final current = List<DiffEntry>.from(state.sessionDiffs);
    final idx = current.indexWhere((d) => d.file == file);
    if (idx >= 0) {
      final old = current[idx];
      current[idx] = DiffEntry(
        file: file,
        before: '',
        after: '',
        additions: old.additions + additions,
        deletions: old.deletions + deletions,
        diff: diff,
        partId: entry.partId,
      );
    } else {
      current.add(entry);
    }
    state = state.copyWith(sessionDiffs: current);
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

  /// Handle a user message that was typed on the Mac terminal (not the app).
  /// Adds it to the chat so the phone shows the prompt in real-time.
  void _handleExternalUserMessage(RuntimeBackendEvent event) {
    final payload = _runtimeMap(event.payload);
    if (payload == null) return;
    final content = payload['content'] as String?;
    if (content == null || content.isEmpty) return;
    final timestamp = payload['timestamp'] as num?;
    final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';
    if (sessionId.isEmpty) return;

    final msgId =
        'ext-user-${event.backend.wireValue}-${timestamp?.toInt() ?? DateTime.now().millisecondsSinceEpoch}';
    if (_messages.containsKey(msgId)) return;

    final message = ChatMessage(
      id: msgId,
      sessionId: sessionId,
      role: MessageRole.user,
      createdAt: timestamp != null
          ? DateTime.fromMillisecondsSinceEpoch(timestamp.toInt())
          : DateTime.now(),
      text: content,
      metadata: const {'deliveryState': 'confirmed', 'source': 'external'},
    );
    _addMessage(message);
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

  /// Confirm all pending user messages (delivery state: pending → confirmed).
  /// Called when any agent starts processing, indicating the message was received.
  void _confirmPendingMessages() {
    bool changed = false;
    for (final id in _order) {
      final msg = _messages[id];
      if (msg == null) continue;
      if (msg.role == MessageRole.user &&
          msg.metadata['deliveryState'] == 'pending') {
        _messages[id] = msg.copyWith(
          metadata: {...msg.metadata, 'deliveryState': 'confirmed'},
        );
        changed = true;
      }
    }
    if (changed) {
      if (_suppressEmit) {
        _pendingEmitMessages = true;
      } else {
        _emitMessages();
      }
    }
  }
}
