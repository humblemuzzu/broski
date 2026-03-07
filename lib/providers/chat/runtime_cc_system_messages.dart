part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// Handles CC-specific `RuntimeBackendEvent` events and creates system
/// ChatMessages for hook status, task progress, auth status, rate limits,
/// file saves, prompt suggestions, and other CC notifications.
///
/// Extracted from runtime_chat_ingest.dart `_handleRuntimeCcBackendEvent`.
extension RuntimeCcSystemMessages on ChatSessionNotifier {
  /// Dispatches a CC backend event to the appropriate system message handler.
  /// Returns without effect for unrecognised kinds.
  void _handleRuntimeCcBackendEvent(RuntimeBackendEvent event) {
    final sessionId = event.sessionId ?? state.ccSessionId ?? '';
    final payload = event.payload;
    final payloadMap = payload is Map<String, dynamic>
        ? payload
        : payload is Map
        ? payload.cast<String, dynamic>()
        : <String, dynamic>{};
    final now = DateTime.fromMillisecondsSinceEpoch(event.timestampMs);

    switch (event.kind) {
      case 'local-command-output':
        final content = (payloadMap['content'] as String? ?? '').trim();
        if (content.isEmpty) return;
        _addMessage(
          ChatMessage(
            id: 'cc-local-command-${event.timestampMs}',
            sessionId: sessionId,
            role: MessageRole.system,
            createdAt: now,
            text: content,
            variant: 'cc-local-command-output',
          ),
        );

      case 'task-started':
        final taskId = payloadMap['taskId']?.toString() ?? '';
        final description = payloadMap['description']?.toString() ?? '';
        _addMessage(
          ChatMessage(
            id: 'cc-task-$taskId',
            sessionId: sessionId,
            role: MessageRole.system,
            createdAt: now,
            text: '⏳ Task started: $description',
            variant: 'task-started',
          ),
        );

      case 'task-progress':
        _handleCcTaskProgress(sessionId, payloadMap, event.timestampMs, now);

      case 'task-notification':
        _handleCcTaskNotification(
          sessionId,
          payloadMap,
          event.timestampMs,
          now,
        );

      case 'tool-use-summary':
        final summary = payloadMap['summary']?.toString() ?? '';
        if (summary.isEmpty) return;
        _addMessage(
          ChatMessage(
            id: 'cc-summary-${event.timestampMs}',
            sessionId: sessionId,
            role: MessageRole.system,
            createdAt: now,
            text: summary,
            variant: 'tool-use-summary',
          ),
        );

      case 'files-persisted':
        _handleCcFilesPersisted(sessionId, payloadMap, event.timestampMs, now);

      case 'auth-status':
        final isAuthenticating =
            payloadMap['isAuthenticating'] == true ||
            payloadMap['status'] == 'authenticating';
        if (isAuthenticating) {
          _addMessage(
            ChatMessage(
              id: 'cc-auth-${event.timestampMs}',
              sessionId: sessionId,
              role: MessageRole.system,
              createdAt: now,
              text: '🔑 Authenticating...',
              variant: 'auth-status',
            ),
          );
        }

      case 'rate-limit-info':
        _handleCcRateLimitInfo(sessionId, payloadMap, event.timestampMs, now);

      case 'prompt-suggestion':
        final suggestion = (payloadMap['suggestion'] as String? ?? '').trim();
        if (suggestion.isEmpty) return;
        _addMessage(
          ChatMessage(
            id: 'cc-prompt-suggestion-${event.timestampMs}',
            sessionId: sessionId,
            role: MessageRole.system,
            createdAt: now,
            text: '💡 Suggested next prompt: $suggestion',
            variant: 'cc-prompt-suggestion',
          ),
        );

      case 'hook-started':
        _handleCcHookStarted(sessionId, payloadMap, event.timestampMs, now);

      case 'hook-progress':
      case 'hook-response':
        _handleCcHookUpdate(sessionId, payloadMap);

      case 'elicitation-request':
        _handleCcElicitationRequestBackend(
          sessionId,
          payloadMap,
          event.timestampMs,
        );

      case 'elicitation-complete':
        _handleCcElicitationCompleteBackend(
          sessionId,
          payloadMap,
          event.timestampMs,
        );

      default:
        break;
    }
  }

  // -- Private helpers --------------------------------------------------------

  void _handleCcTaskProgress(
    String sessionId,
    Map<String, dynamic> payloadMap,
    int timestampMs,
    DateTime now,
  ) {
    final taskId = payloadMap['taskId']?.toString() ?? '';
    final description = payloadMap['description']?.toString() ?? '';
    final totalTokens = payloadMap['totalTokens'];
    final toolUses = payloadMap['toolUses'];
    final durationMs = payloadMap['durationMs'];
    final usageParts = <String>[
      if (totalTokens != null) '$totalTokens tokens',
      if (toolUses != null) '$toolUses tools',
      if (durationMs is num) '${(durationMs / 1000).toStringAsFixed(1)}s',
    ];
    final progressText = usageParts.isEmpty
        ? description
        : '$description (${usageParts.join(', ')})';
    final existingId = 'cc-task-$taskId';
    final existingIdx = state.messages.lastIndexWhere(
      (m) => m.id == existingId,
    );
    if (existingIdx >= 0) {
      _updateMessage(
        existingId,
        state.messages[existingIdx].copyWith(
          text: '⏳ Task running: $progressText',
          variant: 'task-progress',
        ),
      );
    } else {
      _addMessage(
        ChatMessage(
          id: existingId,
          sessionId: sessionId,
          role: MessageRole.system,
          createdAt: now,
          text: '⏳ Task running: $progressText',
          variant: 'task-progress',
        ),
      );
    }
  }

  void _handleCcTaskNotification(
    String sessionId,
    Map<String, dynamic> payloadMap,
    int timestampMs,
    DateTime now,
  ) {
    final taskId = payloadMap['taskId']?.toString() ?? '';
    final summary = payloadMap['summary']?.toString() ?? '';
    final status = payloadMap['status']?.toString() ?? '';
    final isCompleted = payloadMap['isCompleted'] == true;
    final isFailed = payloadMap['isFailed'] == true;
    final totalTokens = payloadMap['totalTokens'];
    final toolUses = payloadMap['toolUses'];
    final durationMs = payloadMap['durationMs'];
    final statusIcon = isCompleted
        ? '✅'
        : isFailed
        ? '❌'
        : '⏳';
    final usageParts = <String>[
      if (totalTokens != null) '$totalTokens tokens',
      if (toolUses != null) '$toolUses tools',
      if (durationMs is num) '${(durationMs / 1000).toStringAsFixed(1)}s',
    ];
    final text = usageParts.isEmpty
        ? '$statusIcon Task: $summary'
        : '$statusIcon Task: $summary (${usageParts.join(', ')})';
    _addMessage(
      ChatMessage(
        id: 'cc-task-$taskId-$timestampMs',
        sessionId: sessionId,
        role: MessageRole.system,
        createdAt: now,
        text: text,
        variant: 'task-notification:$status',
      ),
    );
  }

  void _handleCcFilesPersisted(
    String sessionId,
    Map<String, dynamic> payloadMap,
    int timestampMs,
    DateTime now,
  ) {
    final files = payloadMap['files'];
    final failed = payloadMap['failed'];
    if ((files is List && files.isEmpty) &&
        (failed is List && failed.isEmpty)) {
      return;
    }
    final names = (files is List)
        ? files
              .whereType<Map>()
              .map((f) => f['filename']?.toString() ?? '')
              .where((f) => f.isNotEmpty)
              .toList()
        : <String>[];
    final text = names.isNotEmpty
        ? '💾 Saved ${names.length} file${names.length > 1 ? 's' : ''}: ${names.join(', ')}'
        : '💾 Files persisted';
    _addMessage(
      ChatMessage(
        id: 'cc-files-$timestampMs',
        sessionId: sessionId,
        role: MessageRole.system,
        createdAt: now,
        text: text,
        variant: 'files-persisted',
      ),
    );
  }

  void _handleCcRateLimitInfo(
    String sessionId,
    Map<String, dynamic> payloadMap,
    int timestampMs,
    DateTime now,
  ) {
    final utilization = payloadMap['utilization'];
    final resetsAt = payloadMap['resetsAt'];
    final status = payloadMap['status']?.toString();
    final utilizationPercent = utilization is num
        ? (utilization * 100).round()
        : null;
    final resetAtMs = resetsAt is num
        ? (resetsAt > 1000000000000
              ? resetsAt.toInt()
              : (resetsAt * 1000).toInt())
        : null;
    final parts = <String>[
      if (status != null && status.isNotEmpty) status,
      if (utilizationPercent != null) '$utilizationPercent%',
      if (resetAtMs != null)
        'reset: ${DateTime.fromMillisecondsSinceEpoch(resetAtMs).toLocal()}',
    ];
    final text = parts.isEmpty
        ? '⏱ Claude Code rate-limit update received'
        : '⏱ Claude Code rate-limit update: ${parts.join(' · ')}';
    _addMessage(
      ChatMessage(
        id: 'cc-rate-limit-$timestampMs',
        sessionId: sessionId,
        role: MessageRole.system,
        createdAt: now,
        text: text,
        variant: 'cc-rate-limit',
      ),
    );
  }

  void _handleCcHookStarted(
    String sessionId,
    Map<String, dynamic> payloadMap,
    int timestampMs,
    DateTime now,
  ) {
    final hookId = payloadMap['hookId']?.toString() ?? '';
    final hookName =
        payloadMap['hookName']?.toString() ??
        payloadMap['name']?.toString() ??
        '';
    final hookEvent =
        payloadMap['hookEvent']?.toString() ??
        payloadMap['event']?.toString() ??
        '';
    _addMessage(
      ChatMessage(
        id: 'cc-hook-$hookId',
        sessionId: sessionId,
        role: MessageRole.system,
        createdAt: now,
        text: '⚡ Hook: $hookName ($hookEvent)',
        variant: 'hook:running',
      ),
    );
  }

  void _handleCcHookUpdate(String sessionId, Map<String, dynamic> payloadMap) {
    final hookId = payloadMap['hookId']?.toString() ?? '';
    final hookMsgId = 'cc-hook-$hookId';
    final existingIdx = state.messages.lastIndexWhere((m) => m.id == hookMsgId);
    if (existingIdx >= 0) {
      final existing = state.messages[existingIdx];
      final hookName =
          payloadMap['hookName']?.toString() ??
          payloadMap['name']?.toString() ??
          '';
      final outcome = payloadMap['outcome']?.toString() ?? '';
      final isSuccess = payloadMap['isSuccess'] == true;
      final isError = payloadMap['isError'] == true;
      final statusIcon = isSuccess
          ? '✅'
          : isError
          ? '❌'
          : '⏹';
      _updateMessage(
        existing.id,
        existing.copyWith(
          text: '$statusIcon Hook: $hookName ($outcome)',
          variant: 'hook:$outcome',
        ),
      );
    }
  }
}
