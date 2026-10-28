part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// CX backend_event handlers — metadata, plan, diff events.
/// Extracted from runtime_chat_ingest.dart (Wave 6).
extension _RuntimeCxHandlers on ChatSessionNotifier {
  // ---------------------------------------------------------------------------
  // CX backend_event dispatcher
  // ---------------------------------------------------------------------------

  void _handleRuntimeCxBackendEvent(RuntimeBackendEvent event) {
    final payload = event.payload;
    final payloadMap = payload is Map<String, dynamic>
        ? payload
        : payload is Map
        ? payload.cast<String, dynamic>()
        : <String, dynamic>{};

    switch (event.kind) {
      case 'thread/started':
        final thread = payloadMap['thread'];
        if (thread is Map<String, dynamic>) {
          final id = thread['id']?.toString() ?? '';
          final cwd = thread['cwd']?.toString() ?? state.cxCwd;
          final oldThreadId = state.cxThreadId;
          // Unsubscribe from old thread if switching to a new one
          if (oldThreadId != null &&
              oldThreadId.isNotEmpty &&
              oldThreadId != id &&
              id.isNotEmpty) {
            _bridge
                .cxThreadUnsubscribe(threadId: oldThreadId)
                .catchError((_) => '');
          }
          if (id.isNotEmpty && (oldThreadId == null || oldThreadId.isEmpty)) {
            state = state.copyWith(cxThreadId: id, cxCwd: cwd);
            _bridge.setView(sessionId: id, agent: 'codex');
          }
        }
        _confirmPendingMessages();

      case 'thread/tokenUsage/updated':
        final tokenUsage = payloadMap['tokenUsage'];
        if (tokenUsage is Map<String, dynamic>) {
          state = state.copyWith(
            cxTokenUsage: CodexThreadTokenUsage.fromJson(tokenUsage),
          );
        }

      case 'turn/plan/updated':
        final plan = payloadMap['plan'];
        final explanation = payloadMap['explanation']?.toString();
        if (plan is List) {
          final todos = <Todo>[];
          // Filter out the explanation "todo" — store it as metadata only
          final cleanExplanation =
              (explanation != null && explanation.trim().isNotEmpty)
              ? explanation.trim()
              : null;
          for (var i = 0; i < plan.length; i++) {
            final entry = plan[i];
            if (entry is! Map<String, dynamic>) continue;
            final step = entry['step']?.toString() ?? '';
            final status = entry['status']?.toString() ?? 'pending';
            final mappedStatus = status == 'inProgress'
                ? 'in_progress'
                : status == 'completed'
                ? 'completed'
                : 'pending';
            todos.add(
              Todo(
                id: 'cx-plan-$i',
                content: step,
                status: TodoStatus.fromString(mappedStatus),
                priority: TodoPriority.medium,
              ),
            );
          }
          state = state.copyWith(todos: todos);

          // Add/update inline plan card in chat stream.
          // Use a stable ID so repeated updates replace the same message.
          const planMsgId = 'cx-plan-card';
          final existingIdx = state.messages.indexWhere(
            (m) => m.id == planMsgId,
          );
          final planMsg = ChatMessage(
            id: planMsgId,
            sessionId: state.cxThreadId ?? '',
            role: MessageRole.system,
            createdAt: DateTime.now(),
            text: '', // rendered by variant card
            variant: 'cx-plan-update',
            metadata: {
              if (cleanExplanation != null) 'explanation': cleanExplanation,
            },
          );
          if (existingIdx >= 0) {
            // Replace existing plan card in-place
            final updated = [...state.messages];
            updated[existingIdx] = planMsg;
            state = state.copyWith(messages: updated);
          } else {
            _addMessage(planMsg);
          }
        }

      case 'turn/diff/updated':
        final diff = payloadMap['diff']?.toString() ?? '';
        if (diff.trim().isEmpty) return;
        final perFileDiffs = _parseConsolidatedDiffIntoPerFile(diff);
        if (perFileDiffs.isEmpty) {
          // Fallback: if parsing fails, use a single entry
          final (adds, dels) = _countUnifiedDiffAddsDels(diff);
          state = state.copyWith(
            sessionDiffs: [
              DiffEntry(
                file: 'Changes',
                before: '',
                after: '',
                additions: adds,
                deletions: dels,
                diff: diff,
              ),
            ],
          );
        } else {
          state = state.copyWith(sessionDiffs: perFileDiffs);
        }

      // BUG-3: Model rerouted — show warning
      case 'model/rerouted':
        final from =
            payloadMap['from']?.toString() ??
            payloadMap['originalModel']?.toString() ??
            '';
        final to =
            payloadMap['to']?.toString() ??
            payloadMap['model']?.toString() ??
            '';
        final reason = payloadMap['reason']?.toString() ?? 'capacity';
        if (to.isNotEmpty) {
          _addMessage(
            ChatMessage(
              id: 'cx-model-rerouted-${DateTime.now().millisecondsSinceEpoch}',
              sessionId: state.cxThreadId ?? '',
              role: MessageRole.system,
              createdAt: DateTime.now(),
              text:
                  '⚠️ Model rerouted${from.isNotEmpty ? ' from $from' : ''} to $to ($reason)',
              variant: 'cx-model-rerouted',
              metadata: {'from': from, 'to': to, 'reason': reason},
            ),
          );
        }

      // BUG-6: serverRequest/resolved — dismiss stale approval prompts
      case 'serverRequest/resolved':
        final resolvedRequestId = payloadMap['requestId']?.toString() ?? '';
        if (resolvedRequestId.isNotEmpty) {
          // Remove the pending permission request from state
          final currentPermissions = [...state.permissions];
          currentPermissions.removeWhere((p) => p.id == resolvedRequestId);
          if (currentPermissions.length != state.permissions.length) {
            state = state.copyWith(permissions: currentPermissions);
          }
        }

      // Hook lifecycle
      case 'hook/started':
        final hookId = payloadMap['id']?.toString() ?? '';
        final eventName = payloadMap['eventName']?.toString() ?? '';
        final handlerType = payloadMap['handlerType']?.toString() ?? '';
        if (hookId.isNotEmpty) {
          _addMessage(
            ChatMessage(
              id: 'cx-hook-started-$hookId',
              sessionId: state.cxThreadId ?? '',
              role: MessageRole.system,
              createdAt: DateTime.now(),
              text:
                  '🪝 Hook started: $eventName ${handlerType.isNotEmpty ? '($handlerType)' : ''}',
              variant: 'cx-hook-started',
              metadata: {
                'id': hookId,
                'eventName': eventName,
                'handlerType': handlerType,
              },
            ),
          );
        }

      case 'hook/completed':
        final hookId = payloadMap['id']?.toString() ?? '';
        final hookStatus = payloadMap['status']?.toString() ?? 'completed';
        final statusMessage = payloadMap['statusMessage']?.toString();
        final durationMs = payloadMap['durationMs'];
        final durationStr = durationMs != null
            ? ' (${(durationMs as num).toDouble() / 1000}s)'
            : '';
        if (hookId.isNotEmpty) {
          final icon = hookStatus == 'completed'
              ? '✅'
              : hookStatus == 'failed'
              ? '❌'
              : '⏳';
          _addMessage(
            ChatMessage(
              id: 'cx-hook-completed-$hookId',
              sessionId: state.cxThreadId ?? '',
              role: MessageRole.system,
              createdAt: DateTime.now(),
              text:
                  '🪝 Hook $icon $hookStatus$durationStr${statusMessage != null ? ': $statusMessage' : ''}',
              variant: 'cx-hook-completed',
              metadata: {
                'id': hookId,
                'status': hookStatus,
                'statusMessage': statusMessage,
                'durationMs': durationMs,
              },
            ),
          );
        }

      case 'item/plan/delta':
        break;

      // Terminal interaction — agent needs stdin during command
      case 'terminal_interaction':
        final itemId = payloadMap['itemId']?.toString() ?? '';
        final stableId = itemId.isNotEmpty
            ? 'cx-terminal-interaction-$itemId'
            : 'cx-terminal-interaction';
        final existingIdx = state.messages.indexWhere((m) => m.id == stableId);
        final termMsg = ChatMessage(
          id: stableId,
          sessionId: state.cxThreadId ?? '',
          role: MessageRole.system,
          createdAt: DateTime.now(),
          text:
              '⌨️ Agent is waiting for terminal input${itemId.isNotEmpty ? ' (item: $itemId)' : ''}',
          variant: 'cx-terminal-interaction',
          metadata: {'itemId': itemId},
        );
        if (existingIdx >= 0) {
          final updated = [...state.messages];
          updated[existingIdx] = termMsg;
          state = state.copyWith(messages: updated);
        } else {
          _addMessage(termMsg);
        }

      // Review mode dividers
      case 'enteredReviewMode':
        final review = payloadMap['item']?['review'] ?? payloadMap['review'];
        final reviewType = review is Map
            ? (review['target']?['type']?.toString() ?? '')
            : '';
        _addMessage(
          ChatMessage(
            id: 'cx-review-entered-${DateTime.now().millisecondsSinceEpoch}',
            sessionId: state.cxThreadId ?? '',
            role: MessageRole.system,
            createdAt: DateTime.now(),
            text:
                '🔍 Entered review mode${reviewType.isNotEmpty ? ' ($reviewType)' : ''}',
            variant: 'cx-review-mode',
            metadata: {'entered': true, 'reviewType': reviewType},
          ),
        );

      case 'exitedReviewMode':
        _addMessage(
          ChatMessage(
            id: 'cx-review-exited-${DateTime.now().millisecondsSinceEpoch}',
            sessionId: state.cxThreadId ?? '',
            role: MessageRole.system,
            createdAt: DateTime.now(),
            text: '🔍 Exited review mode',
            variant: 'cx-review-mode',
          ),
        );

      // Context compaction divider
      case 'contextCompaction':
        _addMessage(
          ChatMessage(
            id: 'cx-context-compaction-${DateTime.now().millisecondsSinceEpoch}',
            sessionId: state.cxThreadId ?? '',
            role: MessageRole.system,
            createdAt: DateTime.now(),
            text: '📦 Context compacted — older messages summarized',
            variant: 'cx-context-compaction',
          ),
        );

      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-file diff parser
  // ---------------------------------------------------------------------------

  /// Parses a consolidated unified diff into per-file [DiffEntry] objects.
  List<DiffEntry> _parseConsolidatedDiffIntoPerFile(String diff) {
    final entries = <DiffEntry>[];
    // Split on "diff --git" boundaries if present
    final diffGitPattern = RegExp(r'^diff --git ', multiLine: true);
    if (diff.contains(diffGitPattern)) {
      final chunks = diff.split(diffGitPattern);
      for (final chunk in chunks) {
        if (chunk.trim().isEmpty) continue;
        final plusMatch = RegExp(
          r'^\+\+\+ b/(.+)$',
          multiLine: true,
        ).firstMatch(chunk);
        final file = plusMatch?.group(1)?.trim() ?? 'unknown';
        final chunkText = 'diff --git $chunk';
        final (adds, dels) = _countUnifiedDiffAddsDels(chunkText);
        if (adds > 0 || dels > 0) {
          entries.add(
            DiffEntry(
              file: file,
              before: '',
              after: '',
              additions: adds,
              deletions: dels,
              diff: chunkText.trim(),
            ),
          );
        }
      }
      return entries;
    }

    // Fallback: split on "+++ b/" boundaries
    final lines = diff.split('\n');
    String? currentFile;
    final buffer = <String>[];

    void flush() {
      if (currentFile != null && buffer.isNotEmpty) {
        final text = buffer.join('\n');
        final (adds, dels) = _countUnifiedDiffAddsDels(text);
        if (adds > 0 || dels > 0) {
          entries.add(
            DiffEntry(
              file: currentFile,
              before: '',
              after: '',
              additions: adds,
              deletions: dels,
              diff: text,
            ),
          );
        }
      }
      buffer.clear();
    }

    for (final line in lines) {
      // `--- a/` marks the real file boundary — flush the previous file here
      if (line.startsWith('--- a/') || line.startsWith('--- /dev/null')) {
        flush();
        currentFile = null;
      }
      if (line.startsWith('+++ b/')) {
        final file = line.substring(6).trim();
        if (file.isNotEmpty && file != '/dev/null') {
          currentFile = file;
        }
      }
      buffer.add(line);
    }
    flush();

    return entries;
  }
}
