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

      default:
        break;
    }
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
    final newThreadId =
        (params['newThreadId'] ?? params['new_thread_id'])?.toString();
    final newAgentNickname =
        (params['newAgentNickname'] ?? params['new_agent_nickname'])
            ?.toString();
    final newAgentRole =
        (params['newAgentRole'] ?? params['new_agent_role'])?.toString();
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
