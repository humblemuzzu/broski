part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// OC message.part.* sub-type handlers — text, retry, step, file, agent.
/// Extracted from runtime_chat_ingest.dart (Wave 5).
extension _RuntimeOcPartHandler on ChatSessionNotifier {
  // -- message.part.updated (sub-types) ---------------------------------------

  void _handleRuntimeOcMessagePartUpdated(
    String sessionId,
    Map<String, dynamic> properties,
  ) {
    final part = properties['part'] as Map<String, dynamic>? ?? const {};
    final partSessionId =
        part['sessionID'] as String? ?? part['sessionId'] as String? ?? '';
    if (partSessionId.isNotEmpty && state.session?.id != partSessionId) return;

    final messageId =
        part['messageID'] as String? ??
        part['messageId'] as String? ??
        part['message_id'] as String? ??
        '';
    if (messageId.isEmpty) return;

    var message = _messages[messageId];
    final knownRole = _rolesByMessageId[messageId];
    final resolvedRole = knownRole ?? message?.role ?? MessageRole.assistant;
    final effectiveSessionId =
        partSessionId.isNotEmpty ? partSessionId : sessionId;
    if (message == null) {
      message = ChatMessage(
        id: messageId,
        sessionId: effectiveSessionId,
        role: resolvedRole,
        createdAt: DateTime.now(),
        text: '',
      );
    } else if (message.role != resolvedRole) {
      message = _copyWithRole(message, resolvedRole);
      _messages[messageId] = message;
    }

    final partType = part['type'] as String? ?? '';

    if (partType == 'retry') {
      _handleOcPartRetry(messageId, message, part);
      return;
    }

    if (partType == 'step-start' || partType == 'step-finish') {
      _handleOcPartStep(messageId, message, part, partType);
      return;
    }

    if (partType == 'file') {
      _handleOcPartFile(messageId, message, part);
      return;
    }

    if (partType == 'agent') {
      _handleOcPartAgent(messageId, message, part, effectiveSessionId);
      return;
    }

    if (partType == 'compaction') {
      final current = _messages[messageId] ?? message;
      final isOverflow = part['overflow'] == true;
      _updateMessage(
        messageId,
        current.copyWith(
          error: isOverflow
              ? 'context_compacted_overflow'
              : 'context_compacted',
        ),
      );
      return;
    }

    // patch, snapshot — no additional processing
    if (partType == 'patch' || partType == 'snapshot') {
      return;
    }

    if (partType == 'text') {
      _handleOcPartText(
        messageId,
        message,
        part,
        properties,
        resolvedRole,
        effectiveSessionId,
      );
      return;
    }

    if (partType == 'subtask') {
      final subtask = SubtaskNotification.fromJson(part);
      final exists = message.subtaskNotifications.any(
        (s) => s.id == subtask.id,
      );
      if (!exists) {
        _updateMessage(
          messageId,
          message.copyWith(
            subtaskNotifications: [...message.subtaskNotifications, subtask],
          ),
        );
      }
    }
  }

  void _handleOcPartRetry(
    String messageId,
    ChatMessage message,
    Map<String, dynamic> part,
  ) {
    final attempt = (part['attempt'] as num?)?.toInt() ?? 0;
    final error = part['error'] as Map<String, dynamic>?;
    final errorData = error?['data'] as Map<String, dynamic>?;
    final errorMessage =
        errorData?['message'] as String? ??
        error?['message'] as String? ??
        error?['name'] as String?;

    final current = _messages[messageId] ?? message;
    _updateMessage(
      messageId,
      current.copyWith(
        retryInfo: RetryInfo(attempt: attempt, errorMessage: errorMessage),
      ),
    );
  }

  void _handleOcPartStep(
    String messageId,
    ChatMessage message,
    Map<String, dynamic> part,
    String partType,
  ) {
    final current = _messages[messageId] ?? message;
    if (partType == 'step-finish') {
      final cost = (part['cost'] as num?)?.toDouble() ?? 0;
      final tokens = part['tokens'] as Map<String, dynamic>? ?? const {};
      final tokensInput = tokens['input'] as int? ?? 0;
      final tokensOutput = tokens['output'] as int? ?? 0;
      final tokensReasoning = tokens['reasoning'] as int? ?? 0;
      final tokensTotal = tokens['total'] as int? ?? 0;
      final cache = tokens['cache'] as Map<String, dynamic>? ?? const {};
      final cacheRead = cache['read'] as int? ?? 0;
      final cacheWrite = cache['write'] as int? ?? 0;

      if (tokensTotal > 0 || cost > 0) {
        final tools = current.toolCalls;
        final taskIdx = tools.lastIndexWhere(
          (t) =>
              t.name == 'Task' ||
              t.name == 'task' ||
              t.name == 'subtask' ||
              t.name == 'Subtask',
        );
        if (taskIdx >= 0) {
          final tool = tools[taskIdx];
          final updatedMeta = {
            ...tool.metadata,
            'stepTokens': {
              'input': tokensInput,
              'output': tokensOutput,
              'reasoning': tokensReasoning,
              'total': tokensTotal,
              'cacheRead': cacheRead,
              'cacheWrite': cacheWrite,
            },
            'stepCost': cost,
          };
          final updatedTool = tool.copyWith(metadata: updatedMeta);
          final updatedTools = [
            for (int i = 0; i < tools.length; i++)
              i == taskIdx ? updatedTool : tools[i],
          ];
          _updateMessage(
            messageId,
            current.copyWith(toolCalls: updatedTools, isStreaming: false),
          );
          return;
        }
      }
    }
    _updateMessage(
      messageId,
      current.copyWith(isStreaming: partType == 'step-start'),
    );
  }

  void _handleOcPartFile(
    String messageId,
    ChatMessage message,
    Map<String, dynamic> part,
  ) {
    final partId = part['id'] as String? ?? '';
    final fileName = part['filename'] as String?;
    final mime = part['mime'] as String? ?? '';
    final url = part['url'] as String? ?? '';
    final callId = partId.isNotEmpty
        ? 'attachment:$partId'
        : 'attachment:${DateTime.now().microsecondsSinceEpoch}';

    final current = _messages[messageId] ?? message;

    // For data URIs (e.g. base64-encoded images), don't use the raw URI as
    // the display output — it would render as a huge block of binary text.
    final isDataUri = url.startsWith('data:');
    final displayOutput = fileName ??
        (isDataUri
            ? (mime.isNotEmpty
                ? mime.split('/').last
                : 'attachment')
            : url);

    final attachmentTool = ToolCall(
      callId: callId,
      partId: partId.isNotEmpty ? partId : callId,
      name: 'attachment',
      status: 'completed',
      title: fileName ?? 'Attachment',
      input: {
        if (fileName != null) 'filename': fileName,
        'mime': mime,
        // Data URIs are not stored: OC renders image content through the
        // message text/render stream, not through file-part ToolCall
        // attachments.  Storing multi-MB base64 payloads here would bloat
        // ChatMessage memory without providing any displayable value.
        if (!isDataUri) 'url': url,
        if (isDataUri) 'isDataUri': true,
      },
      output: displayOutput,
      metadata: const {'source': 'file_part'},
    );

    final updatedTools = [
      for (final tool in current.toolCalls)
        if (tool.callId != callId) tool,
      attachmentTool,
    ];

    _updateMessage(messageId, current.copyWith(toolCalls: updatedTools));
  }

  void _handleOcPartAgent(
    String messageId,
    ChatMessage message,
    Map<String, dynamic> part,
    String sessionId,
  ) {
    final subtask = SubtaskNotification(
      id:
          part['id'] as String? ??
          'agent-${DateTime.now().microsecondsSinceEpoch}',
      description: part['name'] as String? ?? 'Agent',
      agent: part['name'] as String? ?? 'agent',
      sessionId: sessionId,
    );
    final current = _messages[messageId] ?? message;
    final exists = current.subtaskNotifications.any(
      (s) => s.id == subtask.id,
    );
    if (!exists) {
      _updateMessage(
        messageId,
        current.copyWith(
          subtaskNotifications: [...current.subtaskNotifications, subtask],
        ),
      );
    }
  }

  void _handleOcPartText(
    String messageId,
    ChatMessage message,
    Map<String, dynamic> part,
    Map<String, dynamic> properties,
    MessageRole resolvedRole,
    String sessionId,
  ) {
    final isSynthetic = part['synthetic'] as bool? ?? false;
    final isIgnored = part['ignored'] as bool? ?? false;
    if (isSynthetic || isIgnored) return;

    final current = _messages[messageId] ?? message;
    if (resolvedRole == MessageRole.user &&
        _localAuthoredUserMessageIds.contains(messageId) &&
        current.text.isNotEmpty) {
      return;
    }

    final delta = properties['delta'] as String?;
    final text = part['text'] as String? ?? '';
    final partTime = part['time'] as Map<String, dynamic>?;
    final isComplete = (partTime?['end'] as int?) != null;
    final shouldShowStreaming =
        resolvedRole == MessageRole.assistant && !isComplete;

    if (resolvedRole == MessageRole.user) {
      final candidate = text.isNotEmpty ? text : (delta ?? '');
      final localId = _findPendingLocalUserMessageId(
        sessionId: sessionId,
        candidateText: candidate,
      );
      if (localId != null) {
        _reconcileLocalUserMessage(
          localMessageId: localId,
          serverMessageId: messageId,
          sessionId: sessionId,
        );
      }
    }

    final runtimeTurn = _findRuntimeTurnByMessageId(
      AgentType.opencode,
      messageId,
    );
    if (resolvedRole == MessageRole.assistant &&
        runtimeTurn != null &&
        runtimeTurn.assistantText.isNotEmpty) {
      final runtimeCurrent = _messages[messageId] ?? message;
      final runtimeText = runtimeTurn.assistantText;
      final runtimeStreaming = runtimeTurn.isStreaming;
      if (runtimeCurrent.text != runtimeText ||
          runtimeCurrent.isStreaming != runtimeStreaming) {
        _updateMessage(
          messageId,
          runtimeCurrent.copyWith(
            text: runtimeText,
            isStreaming: runtimeStreaming,
          ),
        );
      }
      return;
    }

    final currentAfter = _messages[messageId] ?? message;

    if (delta != null && currentAfter.text.isEmpty && text.isNotEmpty) {
      _updateMessage(
        messageId,
        currentAfter.copyWith(text: text, isStreaming: shouldShowStreaming),
      );
      return;
    }

    if (resolvedRole == MessageRole.assistant &&
        delta != null &&
        _lastRttMs > 50) {
      _pendingTextBuffers.putIfAbsent(messageId, () => StringBuffer());
      _pendingTextBuffers[messageId]!.write(delta);

      _textDebounceTimer?.cancel();
      _textDebounceTimer = Timer(
        Duration(milliseconds: _lastRttMs.clamp(30, 100).toInt()),
        () => _flushPendingText(messageId, currentAfter),
      );
    } else {
      final updated = delta != null ? currentAfter.text + delta : text;
      _updateMessage(
        messageId,
        currentAfter.copyWith(
          text: updated,
          isStreaming: delta != null ? true : shouldShowStreaming,
        ),
      );
    }
  }

  RuntimeChatTurnState? _findRuntimeTurnByMessageId(
    AgentType backend,
    String messageId,
  ) {
    for (final turn in _runtimeChatTurns.values) {
      if (turn.backend == backend && turn.messageId == messageId) {
        return turn;
      }
    }
    return null;
  }
}
