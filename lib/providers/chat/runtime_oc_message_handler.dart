part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// OC backend_event handlers — message lifecycle, session metadata, VCS, MCP.
/// Extracted from runtime_chat_ingest.dart (Wave 5).
extension _RuntimeOcMessageHandler on ChatSessionNotifier {
  // ---------------------------------------------------------------------------
  // OC backend_event dispatcher
  // ---------------------------------------------------------------------------

  void _handleRuntimeOcBackendEvent(RuntimeBackendEvent event) {
    final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';
    final payload = event.payload;
    final payloadMap = payload is Map<String, dynamic>
        ? payload
        : payload is Map
            ? payload.cast<String, dynamic>()
            : <String, dynamic>{};

    switch (event.kind) {
      case 'message.updated':
        _handleRuntimeOcMessageUpdated(sessionId, payloadMap);
      case 'message.removed':
        _handleRuntimeOcMessageRemoved(sessionId, payloadMap);
      case 'message.part.removed':
        _handleRuntimeOcMessagePartRemoved(sessionId, payloadMap);
      case 'session.diff':
        _handleRuntimeOcSessionDiff(sessionId, payloadMap);
      case 'todo.updated':
        _handleRuntimeOcTodoUpdated(sessionId, payloadMap);
      case 'session.compacted':
        _handleRuntimeOcSessionCompacted(sessionId, event.timestampMs);
      case 'vcs.branch.updated':
        _handleRuntimeOcVcsBranchUpdated(payloadMap);
      case 'mcp.tools.changed':
        _handleRuntimeOcMcpToolsChanged(sessionId);
      case 'mcp.browser.open.failed':
        _handleRuntimeOcMcpBrowserOpenFailed(payloadMap);
      case 'permission.replied':
        _handleRuntimeOcPermissionReplied(payloadMap);
      case 'question.replied':
        _handleRuntimeOcQuestionReplied(payloadMap);
      case 'question.rejected':
        _handleRuntimeOcQuestionRejected(payloadMap);
      default:
        // message.part.* sub-types for OC-specific part lifecycle
        if (event.kind.startsWith('message.part.')) {
          _handleRuntimeOcMessagePartUpdated(sessionId, payloadMap);
        }
        break;
    }
  }

  // -- message.updated --------------------------------------------------------

  void _handleRuntimeOcMessageUpdated(
    String sessionId,
    Map<String, dynamic> properties,
  ) {
    final info = properties['info'] as Map<String, dynamic>?;
    if (info == null) return;
    final infoSessionId =
        info['sessionID'] as String? ?? info['sessionId'] as String? ?? '';
    if (infoSessionId.isNotEmpty && state.session?.id != infoSessionId) return;

    final messageId = info['id'] as String? ?? '';
    if (messageId.isEmpty) return;
    final roleRaw = info['role'] as String? ?? 'assistant';
    final role = roleRaw == 'user'
        ? MessageRole.user
        : roleRaw == 'system'
            ? MessageRole.system
            : MessageRole.assistant;
    final created =
        info['time']?['created'] as int? ??
        DateTime.now().millisecondsSinceEpoch;
    final variant = info['variant'] as String?;
    final finish = info['finish'] as String?;
    final msgError = info['error'] as Map<String, dynamic>?;
    final msgErrorName = msgError?['name'] as String?;

    _rolesByMessageId[messageId] = role;

    final existing = _messages[messageId];
    if (existing == null) {
      _addMessage(
        ChatMessage(
          id: messageId,
          sessionId: infoSessionId.isNotEmpty ? infoSessionId : sessionId,
          role: role,
          createdAt: DateTime.fromMillisecondsSinceEpoch(created),
          text: '',
          variant: variant,
          finish: finish,
          error: msgErrorName,
        ),
      );
      return;
    }

    if (existing.role != role) {
      final updated = _copyWithRole(existing, role)
          .copyWith(variant: variant, finish: finish, error: msgErrorName);
      _updateMessage(messageId, updated);

      if (role == MessageRole.user && !messageId.startsWith('local-')) {
        final localId = _findPendingLocalUserMessageId(
          sessionId: infoSessionId.isNotEmpty ? infoSessionId : sessionId,
          candidateText: updated.text,
        );
        if (localId != null) {
          _reconcileLocalUserMessage(
            localMessageId: localId,
            serverMessageId: messageId,
            sessionId: infoSessionId.isNotEmpty ? infoSessionId : sessionId,
          );
        }
      }
      return;
    }

    if (role == MessageRole.user &&
        !messageId.startsWith('local-') &&
        existing.text.isNotEmpty) {
      final localId = _findPendingLocalUserMessageId(
        sessionId: infoSessionId.isNotEmpty ? infoSessionId : sessionId,
        candidateText: existing.text,
      );
      if (localId != null) {
        _reconcileLocalUserMessage(
          localMessageId: localId,
          serverMessageId: messageId,
          sessionId: infoSessionId.isNotEmpty ? infoSessionId : sessionId,
        );
      }
    }

    ChatMessage? updated;
    if (variant != null && variant != existing.variant) {
      updated = (updated ?? existing).copyWith(variant: variant);
    }
    if (msgErrorName != null && msgErrorName != existing.error) {
      updated = (updated ?? existing).copyWith(error: msgErrorName);
    }
    if (finish != null && finish != existing.finish) {
      updated = (updated ?? existing).copyWith(finish: finish);
    }
    if (updated != null) {
      _updateMessage(messageId, updated);
    }
  }

  // -- message.removed --------------------------------------------------------

  void _handleRuntimeOcMessageRemoved(
    String sessionId,
    Map<String, dynamic> properties,
  ) {
    final info = properties['info'] as Map<String, dynamic>? ?? const {};
    final infoSessionId =
        info['sessionID'] as String? ??
        info['sessionId'] as String? ??
        properties['sessionID'] as String? ??
        properties['sessionId'] as String? ??
        '';
    if (infoSessionId.isNotEmpty && state.session?.id != infoSessionId) return;

    final messageId =
        info['id'] as String? ??
        properties['messageID'] as String? ??
        properties['messageId'] as String? ??
        '';
    if (messageId.isEmpty) return;

    final removedFromMap = _messages.remove(messageId) != null;
    final removedFromOrder = _order.remove(messageId);
    _rolesByMessageId.remove(messageId);
    _pendingTextBuffers.remove(messageId);

    if (removedFromMap || removedFromOrder) {
      if (_suppressEmit) {
        _pendingEmitMessages = true;
      } else {
        _emitMessages();
      }
    }
  }

  // -- message.part.removed ---------------------------------------------------

  void _handleRuntimeOcMessagePartRemoved(
    String sessionId,
    Map<String, dynamic> properties,
  ) {
    final part = properties['part'] as Map<String, dynamic>? ?? const {};
    final partSessionId =
        part['sessionID'] as String? ??
        part['sessionId'] as String? ??
        properties['sessionID'] as String? ??
        properties['sessionId'] as String? ??
        '';
    if (partSessionId.isNotEmpty && state.session?.id != partSessionId) return;

    final messageId =
        part['messageID'] as String? ??
        part['messageId'] as String? ??
        properties['messageID'] as String? ??
        properties['messageId'] as String? ??
        '';
    final partId =
        part['id'] as String? ??
        properties['partID'] as String? ??
        properties['partId'] as String? ??
        '';
    if (messageId.isEmpty || partId.isEmpty) return;

    final existing = _messages[messageId];
    if (existing == null) return;

    final partType = part['type'] as String?;
    final updatedTools = existing.toolCalls
        .where((tool) => tool.partId != partId && tool.callId != partId)
        .toList();
    final updatedDiffs = existing.diffs
        .where((diff) => diff.partId != partId)
        .toList();
    final updatedSubtasks = existing.subtaskNotifications
        .where((subtask) => subtask.id != partId)
        .toList();
    final updatedReasoning = existing.reasoningParts
        .where((reasoning) => reasoning.id != partId)
        .toList();

    var updated = existing.copyWith(
      toolCalls: updatedTools,
      diffs: updatedDiffs,
      subtaskNotifications: updatedSubtasks,
      reasoningParts: updatedReasoning,
      retryInfo: partType == 'retry' ? null : existing.retryInfo,
      text: existing.text,
    );

    if (partType == 'step-finish') {
      updated = updated.copyWith(isStreaming: false);
    }

    _updateMessage(messageId, updated);
  }

  // -- session.diff -----------------------------------------------------------

  void _handleRuntimeOcSessionDiff(
    String sessionId,
    Map<String, dynamic> properties,
  ) {
    final diffSessionId =
        properties['sessionID'] as String? ??
        properties['sessionId'] as String? ??
        '';
    if (diffSessionId.isNotEmpty && state.session?.id != diffSessionId) return;

    final diffs = (properties['diff'] as List<dynamic>? ?? [])
        .map(
          (item) => DiffEntry(
            file: item['file'] as String? ?? '',
            before: item['before'] as String? ?? '',
            after: item['after'] as String? ?? '',
            additions: item['additions'] as int? ?? 0,
            deletions: item['deletions'] as int? ?? 0,
            diff: item['diff'] as String?,
            partId: item['partId'] as String?,
            status: item['status'] as String?,
          ),
        )
        .toList();

    if (diffs.isEmpty) return;
    state = state.copyWith(sessionDiffs: diffs);
  }

  // -- todo.updated -----------------------------------------------------------

  void _handleRuntimeOcTodoUpdated(
    String sessionId,
    Map<String, dynamic> properties,
  ) {
    final todoSessionId =
        properties['sessionID'] as String? ??
        properties['sessionId'] as String? ??
        '';
    if (todoSessionId.isNotEmpty && state.session?.id != todoSessionId) return;

    final todosJson = properties['todos'] as List<dynamic>? ?? [];
    final todos = todosJson
        .map((item) => Todo.fromJson(item as Map<String, dynamic>))
        .toList();

    developer.log('Todos updated: ${todos.length} items', name: 'ChatProvider');
    state = state.copyWith(todos: todos);
  }

  // -- session.compacted ------------------------------------------------------

  void _handleRuntimeOcSessionCompacted(String sessionId, int timestampMs) {
    developer.log('Session compacted: $sessionId', name: 'ChatProvider');
    state = state.copyWith(isCompacting: false);

    final compactionMsg = ChatMessage(
      id: 'oc-compaction-${DateTime.now().microsecondsSinceEpoch}',
      sessionId: sessionId,
      role: MessageRole.system,
      createdAt: DateTime.fromMillisecondsSinceEpoch(timestampMs),
      text: 'Context compacted',
      error: 'context_compacted',
    );
    _addMessage(compactionMsg);
  }

  // -- vcs.branch.updated -----------------------------------------------------

  void _handleRuntimeOcVcsBranchUpdated(Map<String, dynamic> properties) {
    final branch = properties['branch'] as String?;
    developer.log('VCS branch updated: $branch', name: 'ChatProvider');
    state = state.copyWith(vcsInfo: VcsInfo(branch: branch));
  }

  // -- mcp.tools.changed -----------------------------------------------------

  void _handleRuntimeOcMcpToolsChanged(String sessionId) {
    unawaited(
      _bridge
          .listToolIds(projectPath: state.projectPath)
          .catchError((_) => const <String>[]),
    );
  }

  // -- mcp.browser.open.failed ------------------------------------------------

  void _handleRuntimeOcMcpBrowserOpenFailed(Map<String, dynamic> properties) {
    final mcpName =
        properties['mcpName'] as String? ??
        properties['server'] as String? ??
        'MCP Server';
    final url = properties['url'] as String?;

    if (kDebugMode) {
      developer.log(
        'MCP OAuth browser open failed for $mcpName${url != null ? ': $url' : ''}',
        name: 'ChatProvider',
      );
    }

    if (url != null && url.isNotEmpty) {
      state = state.copyWith(
        mcpOAuthPending: McpOAuthPending(serverName: mcpName, url: url),
      );
    }
  }

  // -- OC permission/question removal via backend_event -----------------------

  void _handleRuntimeOcPermissionReplied(Map<String, dynamic> properties) {
    final requestId = (properties['permissionID'] ??
            properties['requestID'] ??
            properties['requestId'] ??
            properties['id'])
        ?.toString();
    if (requestId == null || requestId.isEmpty) return;
    state = state.copyWith(
      permissions:
          state.permissions.where((p) => p.id != requestId).toList(),
    );
  }

  void _handleRuntimeOcQuestionReplied(Map<String, dynamic> properties) {
    final requestId = (properties['requestID'] ??
            properties['requestId'])
        ?.toString();
    if (requestId == null || requestId.isEmpty) return;
    if (state.pendingQuestion?.id == requestId) {
      state = state.copyWith(pendingQuestion: null);
    }
  }

  void _handleRuntimeOcQuestionRejected(Map<String, dynamic> properties) {
    final requestId = (properties['requestID'] ??
            properties['requestId'])
        ?.toString();
    if (requestId == null || requestId.isEmpty) return;
    if (state.pendingQuestion?.id == requestId) {
      state = state.copyWith(pendingQuestion: null);
    }
  }
}
