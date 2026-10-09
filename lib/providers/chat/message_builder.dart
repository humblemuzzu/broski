part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// Core message operations: construction, reconciliation, diff extraction.
/// Extracted from chat_provider.dart.
extension MessageBuilder on ChatSessionNotifier {
  String _normalizeUserText(String text) {
    return text.trim().replaceAll(RegExp(r'\s+'), ' ');
  }

  bool _isTextMatch(String a, String b) {
    if (a.isEmpty || b.isEmpty) return false;
    if (a == b) return true;
    return a.startsWith(b) || b.startsWith(a);
  }

  String? _findPendingLocalUserMessageId({
    required String sessionId,
    required String candidateText,
  }) {
    final normalizedCandidate = _normalizeUserText(candidateText);
    if (normalizedCandidate.isEmpty) return null;

    String? matchId;
    for (final entry in _pendingLocalUserTextByMessageId.entries) {
      final localId = entry.key;
      final localMsg = _messages[localId];
      if (localMsg == null) continue;
      if (localMsg.sessionId != sessionId) continue;
      if (localMsg.role != MessageRole.user) continue;
      // Accept both local-xxx (no messageId supplied) and msg_xxx (client-
      // generated OpenCode IDs) — any ID in _pendingLocalUserTextByMessageId
      // is an optimistic local message awaiting reconciliation.
      if (_isTextMatch(entry.value, normalizedCandidate)) {
        matchId = localId; // keep last match (most recent insertion order)
      }
    }
    return matchId;
  }

  ChatMessage _copyWithRole(ChatMessage message, MessageRole role) {
    return ChatMessage(
      id: message.id,
      sessionId: message.sessionId,
      role: role,
      createdAt: message.createdAt,
      text: message.text,
      toolCalls: message.toolCalls,
      diffs: message.diffs,
      subtaskNotifications: message.subtaskNotifications,
      reasoningParts: message.reasoningParts,
      parts: message.parts,
      isStreaming: message.isStreaming,
      error: message.error,
    );
  }

  void _reconcileLocalUserMessage({
    required String localMessageId,
    required String serverMessageId,
    required String sessionId,
  }) {
    final localMsg = _messages[localMessageId];
    if (localMsg == null) return;

    final localIndex = _order.indexOf(localMessageId);
    _messages.remove(localMessageId);
    if (localIndex >= 0) {
      _order.removeAt(localIndex);
    }
    _pendingLocalUserTextByMessageId.remove(localMessageId);
    _localAuthoredUserMessageIds.remove(localMessageId);

    final existingServer = _messages[serverMessageId];
    if (existingServer == null) {
      _messages[serverMessageId] = ChatMessage(
        id: serverMessageId,
        sessionId: sessionId,
        role: MessageRole.user,
        createdAt: localMsg.createdAt,
        text: localMsg.text,
        toolCalls: localMsg.toolCalls,
        diffs: localMsg.diffs,
        subtaskNotifications: localMsg.subtaskNotifications,
        reasoningParts: localMsg.reasoningParts,
        parts: localMsg.parts,
        isStreaming: false,
        error: localMsg.error,
      );
    }

    final existingIndex = _order.indexOf(serverMessageId);
    if (existingIndex >= 0) {
      _order.removeAt(existingIndex);
    }
    final insertIndex = localIndex >= 0
        ? localIndex.clamp(0, _order.length).toInt()
        : _order.length;
    _order.insert(insertIndex, serverMessageId);

    if (_suppressEmit) {
      _pendingEmitMessages = true;
    } else {
      _emitMessages();
    }
  }

  String appendUserMessage(String content, {String? messageId}) {
    // Handle Claude Code mode
    if (state.isClaudeCode) {
      final sessionId = state.ccSessionId ?? '';
      final id = messageId ?? 'local-${DateTime.now().microsecondsSinceEpoch}';
      final message = ChatMessage(
        id: id,
        sessionId: sessionId,
        role: MessageRole.user,
        createdAt: DateTime.now(),
        text: content,
        metadata: const {'deliveryState': 'pending'},
      );
      _addMessage(message);
      return id;
    }

    // Codex mode
    if (state.isCodex) {
      final threadId = state.cxThreadId ?? '';
      final id = messageId ?? 'local-${DateTime.now().microsecondsSinceEpoch}';
      final message = ChatMessage(
        id: id,
        sessionId: threadId,
        role: MessageRole.user,
        createdAt: DateTime.now(),
        text: content,
        metadata: const {'deliveryState': 'pending'},
      );
      _addMessage(message);
      return id;
    }

    // Pi mode
    if (state.isPi) {
      final sessionId = state.piSessionId ?? '';
      final id = messageId ?? 'local-${DateTime.now().microsecondsSinceEpoch}';
      final message = ChatMessage(
        id: id,
        sessionId: sessionId,
        role: MessageRole.user,
        createdAt: DateTime.now(),
        text: content,
        metadata: const {'deliveryState': 'pending'},
      );
      _addMessage(message);
      return id;
    }

    // OpenCode mode
    final session = state.session;
    if (session == null) return '';

    final id = messageId ?? 'local-${DateTime.now().microsecondsSinceEpoch}';
    final message = ChatMessage(
      id: id,
      sessionId: session.id,
      role: MessageRole.user,
      createdAt: DateTime.now(),
      text: content,
      metadata: const {'deliveryState': 'pending'},
    );
    _addMessage(message);
    if (messageId != null && messageId.isNotEmpty) {
      _localAuthoredUserMessageIds.add(messageId);
      // Also register text for reconciliation: OpenCode SDK generates its own
      // message ID (different from the client-generated one), so we need
      // text-based matching to detect & replace this optimistic message when
      // the server echo arrives with a different ID.
      final normalized = _normalizeUserText(content);
      if (normalized.isNotEmpty) {
        _pendingLocalUserTextByMessageId[id] = normalized;
      }
    } else {
      final normalized = _normalizeUserText(content);
      if (normalized.isNotEmpty) {
        _pendingLocalUserTextByMessageId[id] = normalized;
      }
    }
    return id;
  }

  void appendLocalAssistantMessage(String content) {
    final sessionId = state.isClaudeCode
        ? (state.ccSessionId ?? '')
        : state.isCodex
        ? (state.cxThreadId ?? '')
        : state.isPi
        ? (state.piSessionId ?? '')
        : (state.session?.id ?? '');
    if (sessionId.isEmpty) return;
    final message = ChatMessage(
      id: 'local-assistant-${DateTime.now().microsecondsSinceEpoch}',
      sessionId: sessionId,
      role: MessageRole.assistant,
      createdAt: DateTime.now(),
      text: content,
    );
    _addMessage(message);
  }

  void resolvePermission(String permissionId) {
    state = state.copyWith(
      permissions: state.permissions
          .where((item) => item.id != permissionId)
          .toList(),
    );
  }

  List<DiffEntry> _mergeToolDiffs(
    List<DiffEntry> existing, {
    required ToolCall tool,
  }) {
    final extracted = _extractDiffFromTool(tool);
    if (extracted == null) return existing;

    // Dedupe by (file, partId) to avoid repeated tool updates spamming diffs.
    return [
      for (final diff in existing)
        if (diff.file != extracted.file || diff.partId != extracted.partId)
          diff,
      extracted,
    ];
  }

  DiffEntry? _extractDiffFromTool(ToolCall tool) {
    final status = tool.status.toLowerCase();
    final isFinal =
        status == 'completed' ||
        status == 'success' ||
        status == 'error' ||
        status == 'failed';
    if (!isFinal) return null;

    final metadata = tool.metadata;
    if (metadata.isEmpty) return null;

    final diffText = metadata['diff'] as String?;
    final filediff = metadata['filediff'];

    String file = '';
    String before = '';
    String after = '';
    String? fileStatus;
    int additions = 0;
    int deletions = 0;

    if (filediff is Map<String, dynamic>) {
      file =
          filediff['file'] as String? ??
          filediff['path'] as String? ??
          filediff['after'] as String? ??
          filediff['before'] as String? ??
          '';
      before = filediff['before'] as String? ?? '';
      after = filediff['after'] as String? ?? '';
      fileStatus = filediff['status'] as String?;
      additions = (filediff['additions'] as num?)?.toInt() ?? 0;
      deletions = (filediff['deletions'] as num?)?.toInt() ?? 0;
    }

    file = file.isNotEmpty
        ? file
        : (tool.input['filePath'] as String? ??
              tool.input['path'] as String? ??
              tool.input['file'] as String? ??
              '');

    // If we only have a unified diff text, derive +/- counts from it.
    if ((additions == 0 && deletions == 0) && diffText != null) {
      final lines = diffText.split('\n');
      for (final line in lines) {
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('+')) additions++;
        if (line.startsWith('-')) deletions++;
      }
    }

    if (file.isEmpty) return null;
    if ((diffText == null || diffText.isEmpty) &&
        before.isEmpty &&
        after.isEmpty) {
      return null;
    }

    return DiffEntry(
      file: file,
      before: before,
      after: after,
      additions: additions,
      deletions: deletions,
      diff: diffText,
      partId: tool.partId,
      status: fileStatus,
    );
  }

  /// Update todos from fetched data (called by chat screen)
  void setTodos(List<Todo> todos) {
    state = state.copyWith(todos: todos);
  }

  /// Set compacting state (called when starting summarize)
  void setCompacting(bool isCompacting) {
    state = state.copyWith(isCompacting: isCompacting);
  }

  /// Update VCS info from fetched data
  void setVcsInfo(VcsInfo vcsInfo) {
    state = state.copyWith(vcsInfo: vcsInfo);
  }

  /// Update session status from fetched data
  void setSessionStatus(SessionStatus status) {
    state = state.copyWith(sessionStatus: status);
  }

  void _addMessage(ChatMessage message) {
    if (!_messages.containsKey(message.id)) {
      _order.add(message.id);
    }
    _messages[message.id] = message;
    if (_suppressEmit) {
      _pendingEmitMessages = true;
      return;
    }
    _emitMessages();
  }

  void _updateMessage(String id, ChatMessage message) {
    if (!_messages.containsKey(id)) {
      _order.add(id);
    }
    _messages[id] = message;
    if (_suppressEmit) {
      _pendingEmitMessages = true;
      return;
    }
    _emitMessages();
  }

  void _emitMessages() {
    final list = _order.map((id) => _messages[id]!).toList();
    // FIX: Calculate content length here once when messages change
    // instead of recalculating on every UI frame
    final contentLength = _calculateContentLength(list);
    state = state.copyWith(messages: list, contentLength: contentLength);
  }

  /// Calculate content length for auto-scroll detection
  /// This is now called once per emit instead of every frame
  int _calculateContentLength(List<ChatMessage> messages) {
    int length = 0;
    for (final msg in messages) {
      length += msg.text.length;
      length += msg.toolCalls.length * 100;
      length += msg.diffs.length * 100;
      length += msg.subtaskNotifications.length * 50;
      length += msg.reasoningParts.fold(0, (sum, r) => sum + r.text.length);
    }
    return length;
  }

  /// Mark all streaming messages as complete (for abort/unstick scenarios)
  void markAllStreamingComplete() {
    var changed = false;
    for (final id in _order) {
      final msg = _messages[id];
      if (msg == null) continue;
      if (!msg.isStreaming) continue;
      _messages[id] = msg.copyWith(isStreaming: false);
      changed = true;
    }
    // Also clear any streaming-related state flags
    state = state.copyWith(sessionStatus: const SessionStatus.idle());
    if (changed) {
      if (_suppressEmit) {
        _pendingEmitMessages = true;
      } else {
        _emitMessages();
      }
    }
  }
}
