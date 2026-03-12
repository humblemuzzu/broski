part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// CX backend_event handlers — metadata, plan, diff, collab events.
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
          if (id.isNotEmpty &&
              (state.cxThreadId == null || state.cxThreadId!.isEmpty)) {
            state = state.copyWith(cxThreadId: id, cxCwd: cwd);
            _bridge.setView(sessionId: id, agent: 'codex');
          }
        }

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
          if (explanation != null && explanation.trim().isNotEmpty) {
            todos.add(
              Todo(
                id: 'cx-plan-explanation',
                content: '📋 ${explanation.trim()}',
                status: TodoStatus.completed,
                priority: TodoPriority.high,
              ),
            );
          }
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

      // Collab events (from bridge mapper top-level types)
      case 'collab_spawn_begin':
      case 'collab_spawn_end':
      case 'collab_interaction_begin':
      case 'collab_interaction_end':
      case 'collab_waiting_begin':
      case 'collab_waiting_end':
      case 'collab_close_begin':
      case 'collab_close_end':
      case 'collab_resume_begin':
      case 'collab_resume_end':
        _handleRuntimeCxCollabEvent(event.kind, payloadMap);

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
            ),
          );
        }

      // Plan text streaming delta
      case 'item/plan/delta':
        // Plan deltas are handled via raw cx_stream passthrough
        break;

      // Terminal interaction — agent needs stdin during command
      case 'terminal_interaction':
        final itemId = payloadMap['itemId']?.toString() ?? '';
        _addMessage(
          ChatMessage(
            id: 'cx-terminal-interaction-${DateTime.now().millisecondsSinceEpoch}',
            sessionId: state.cxThreadId ?? '',
            role: MessageRole.system,
            createdAt: DateTime.now(),
            text:
                '⌨️ Agent is waiting for terminal input${itemId.isNotEmpty ? ' (item: $itemId)' : ''}',
            variant: 'cx-terminal-interaction',
          ),
        );

      // Review mode dividers
      case 'enteredReviewMode':
        final review = payloadMap['item']?['review'] ?? payloadMap['review'];
        final reviewType = review is Map ? (review['target']?['type']?.toString() ?? '') : '';
        _addMessage(
          ChatMessage(
            id: 'cx-review-entered-${DateTime.now().millisecondsSinceEpoch}',
            sessionId: state.cxThreadId ?? '',
            role: MessageRole.system,
            createdAt: DateTime.now(),
            text: '🔍 Entered review mode${reviewType.isNotEmpty ? ' ($reviewType)' : ''}',
            variant: 'cx-review-mode',
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

  // ---------------------------------------------------------------------------
  // CX collab event handler
  // ---------------------------------------------------------------------------

  void _handleRuntimeCxCollabEvent(String kind, Map<String, dynamic> params) {
    final senderThreadId =
        (params['senderThreadId'] ?? params['sender_thread_id'])?.toString() ??
        state.cxThreadId ??
        '';
    final receiverThreadId =
        (params['receiverThreadId'] ?? params['receiver_thread_id'])
            ?.toString();
    final newThreadId = (params['newThreadId'] ?? params['new_thread_id'])
        ?.toString();
    final newAgentNickname =
        (params['newAgentNickname'] ?? params['new_agent_nickname'])
            ?.toString();
    final newAgentRole = (params['newAgentRole'] ?? params['new_agent_role'])
        ?.toString();
    final prompt = params['prompt']?.toString();

    CodexCollabAgentStatus? parseStatus(dynamic statusData) {
      if (statusData == null) return null;
      if (statusData is Map<String, dynamic>) {
        return CodexCollabAgentStatus.fromJson(statusData);
      } else if (statusData is String) {
        return CodexCollabAgentStatus.fromString(statusData);
      }
      return null;
    }

    final status = parseStatus(params['status']);

    CodexCollabAgentTree getOrCreateTree() {
      return state.cxCollabTree ??
          CodexCollabAgentTree(rootThreadId: state.cxThreadId ?? '');
    }

    switch (kind) {
      case 'collab_spawn_begin':
        break; // debug logging only in original

      case 'collab_spawn_end':
        if (newThreadId != null && newThreadId.isNotEmpty) {
          final tree = getOrCreateTree();
          tree.addNode(
            CodexCollabAgentNode(
              threadId: newThreadId,
              parentThreadId: senderThreadId,
              status: status ?? CodexCollabAgentStatus.running,
              prompt: prompt,
              agentNickname: newAgentNickname,
              agentRole: newAgentRole,
              startedAt: DateTime.now(),
            ),
          );
          state = state.copyWith(cxCollabTree: tree);
        }

      case 'collab_interaction_begin':
        break; // debug logging only in original

      case 'collab_interaction_end':
        if (receiverThreadId != null && status != null) {
          final tree = state.cxCollabTree;
          if (tree != null) {
            tree.updateStatus(receiverThreadId, status);
            state = state.copyWith(cxCollabTree: tree);
          }
        }

      case 'collab_waiting_begin':
        final receiverIds =
            (params['receiverThreadIds'] ?? params['receiver_thread_ids']);
        if (receiverIds is List) {
          final tree = state.cxCollabTree;
          if (tree != null) {
            tree.updateWaitingFor(
              senderThreadId,
              receiverIds.map((e) => e.toString()).toList(),
            );
            state = state.copyWith(cxCollabTree: tree);
          }
        }

      case 'collab_waiting_end':
        final statuses = params['statuses'];
        if (statuses is Map) {
          final tree = state.cxCollabTree;
          if (tree != null) {
            for (final entry in statuses.entries) {
              final tid = entry.key.toString();
              final st = parseStatus(entry.value);
              if (st != null) {
                tree.updateStatus(tid, st);
              }
            }
            tree.updateWaitingFor(senderThreadId, []);
            state = state.copyWith(cxCollabTree: tree);
          }
        }

      case 'collab_close_begin':
        break; // debug logging only in original

      case 'collab_close_end':
        if (receiverThreadId != null) {
          final tree = state.cxCollabTree;
          if (tree != null) {
            tree.updateStatus(
              receiverThreadId,
              status ?? CodexCollabAgentStatus.shutdown,
            );
            state = state.copyWith(cxCollabTree: tree);
          }
        }

      case 'collab_resume_begin':
        break; // debug logging only in original

      case 'collab_resume_end':
        if (receiverThreadId != null) {
          final tree = state.cxCollabTree;
          if (tree != null) {
            tree.updateStatus(
              receiverThreadId,
              status ?? CodexCollabAgentStatus.running,
            );
            state = state.copyWith(cxCollabTree: tree);
          }
        }
    }
  }
}
