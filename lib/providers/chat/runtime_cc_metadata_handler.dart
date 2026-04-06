part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// Handles CC-specific metadata enrichment for runtime events.
///
/// This replaces the old `runtime_cc_extensions.dart` that consumed `cc_stream`
/// events directly. Now these handlers process data from:
/// - `tool_started` / `tool_finished` events with CC backendData
/// - `agent_started` / `agent_finished` events with CC backendData
///
/// Extracted during the runtime abstraction completion (dual-path removal).
extension RuntimeCcMetadataHandler on ChatSessionNotifier {
  // ---------------------------------------------------------------------------
  // CC agent_started — set view when session begins
  // ---------------------------------------------------------------------------

  void _handleRuntimeCcAgentStarted(RuntimeAgentStartedEvent event) {
    final sessionId = (event.sessionId ?? '').trim();
    final currentSessionId = (state.ccSessionId ?? '').trim();
    if (sessionId.isNotEmpty && sessionId != currentSessionId) {
      _bridge.setView(sessionId: sessionId, agent: 'claude-code');
    }
    final model = event.backendData?['model']?.toString();
    if (model != null && model.isNotEmpty) {
      state = state.copyWith(ccModel: model);
    }
  }

  // ---------------------------------------------------------------------------
  // CC agent_finished — refusal, errors, permission denials, fast mode
  // ---------------------------------------------------------------------------

  void _handleRuntimeCcAgentFinished(RuntimeAgentFinishedEvent event) {
    final backendData = event.backendData ?? {};
    final sessionId = event.sessionId ?? state.ccSessionId ?? '';

    // Refusal
    if (event.stopReason == 'refusal') {
      _addMessage(
        ChatMessage(
          id: 'cc-stop-refusal-${DateTime.now().microsecondsSinceEpoch}',
          sessionId: sessionId,
          role: MessageRole.system,
          createdAt: DateTime.now(),
          text: '⛔ Claude refused this request.',
          variant: 'cc-stop:refusal',
        ),
      );
    }

    // Error signal
    final isError = backendData['isError'] == true;
    if (isError) {
      final subtype =
          backendData['subtype']?.toString() ?? 'error_during_execution';
      final label = switch (subtype) {
        'error_max_turns' => 'Reached max turns',
        'error_max_budget_usd' => 'Reached budget limit',
        'error_max_structured_output_retries' =>
          'Structured output retries exceeded',
        _ => 'Execution error',
      };
      final errors = backendData['errors'];
      final firstError = (errors is List && errors.isNotEmpty)
          ? ' - ${errors.first}'
          : '';
      _addMessage(
        ChatMessage(
          id: 'cc-result-error-${DateTime.now().microsecondsSinceEpoch}',
          sessionId: sessionId,
          role: MessageRole.system,
          createdAt: DateTime.now(),
          text: '⚠️ $label$firstError',
          variant: 'cc-result:$subtype',
        ),
      );
    }

    // Permission denials
    final denials = backendData['permissionDenials'];
    if (denials is List && denials.isNotEmpty) {
      final deniedTools = denials
          .whereType<Map>()
          .map((denial) => denial['toolName']?.toString() ?? '')
          .where((name) => name.isNotEmpty)
          .toSet()
          .toList();
      if (deniedTools.isNotEmpty) {
        _addMessage(
          ChatMessage(
            id: 'cc-denials-${DateTime.now().microsecondsSinceEpoch}',
            sessionId: sessionId,
            role: MessageRole.system,
            createdAt: DateTime.now(),
            text: '🔒 Permission denied: ${deniedTools.join(', ')}',
            variant: 'cc-permission-denials',
          ),
        );
      }
    }

    // Fast mode state
    final fastModeState = backendData['fastModeState']?.toString();
    _emitCcFastModeState(fastModeState);
  }

  // ---------------------------------------------------------------------------
  // CC tool_started — TodoWrite, nested tool tracking, subagent metadata
  // ---------------------------------------------------------------------------

  void _handleRuntimeCcToolStarted(RuntimeToolStartedEvent event) {
    final backendData = event.backendData ?? {};
    final toolName = event.toolName ?? '';

    // TodoWrite handling
    if (toolName == 'TodoWrite') {
      _handleCCTodoWrite(event.input);
      return;
    }

    // Nested tool tracking
    final parentToolUseId = backendData['parentToolUseId']?.toString();
    if (parentToolUseId != null && parentToolUseId.isNotEmpty) {
      final toolCallId =
          event.toolCallId ?? 'cc-${DateTime.now().microsecondsSinceEpoch}';
      final parentId = parentToolUseId;
      final nested = _ccNestedToolCalls.putIfAbsent(parentId, () => []);
      final existingIndex = nested.indexWhere(
        (tool) => tool.callId == toolCallId,
      );
      final inputMap = event.input is Map<String, dynamic>
          ? event.input as Map<String, dynamic>
          : {'input': event.input?.toString() ?? ''};
      final status = backendData['status']?.toString() ?? 'running';
      final nextTool = ToolCall(
        callId: toolCallId,
        partId: toolCallId,
        name: toolName,
        status: status,
        title: toolName,
        input: inputMap,
        metadata: const {},
      );
      if (existingIndex >= 0) {
        nested[existingIndex] = nextTool;
      } else {
        nested.add(nextTool);
      }
      _replaceRuntimeTool(
        AgentType.claudeCode,
        parentId,
        (current) => current.copyWith(
          metadata: {
            ...current.metadata,
            'nestedToolCount': nested.length,
            'subagentName':
                _ccActiveSubagentNames[parentId] ??
                current.metadata['subagentName'],
          },
        ),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // CC tool_finished — nested tool completion, metadata enrichment
  // ---------------------------------------------------------------------------

  void _handleRuntimeCcToolFinished(RuntimeToolFinishedEvent event) {
    final backendData = event.backendData ?? {};
    final toolUseId = event.toolCallId;
    if (toolUseId == null || toolUseId.isEmpty) return;

    final toolMeta = _ccMetadataFromToolUseResult(backendData['toolUseResult']);

    // Accumulate file diffs into sessionDiffs for the Changes sidebar section.
    // _ccMetadataFromToolUseResult sets 'filediff' when the tool modified a file.
    _accumulateCcSessionDiff(toolMeta, toolUseId);

    final parentToolUseId = backendData['parentToolUseId']?.toString();
    if (parentToolUseId != null && parentToolUseId.isNotEmpty) {
      final nested = _ccNestedToolCalls[parentToolUseId];
      if (nested != null) {
        for (var i = 0; i < nested.length; i++) {
          if (nested[i].callId != toolUseId) continue;
          nested[i] = nested[i].copyWith(
            status: 'completed',
            output: event.output?.toString(),
            metadata: {...nested[i].metadata, ...toolMeta},
          );
          break;
        }
      }
      return;
    }

    _replaceRuntimeTool(AgentType.claudeCode, toolUseId, (current) {
      final isTaskTool =
          current.name.toLowerCase() == 'task' ||
          current.name.toLowerCase() == 'subtask' ||
          current.name.toLowerCase() == 'agent';
      final nestedCalls = isTaskTool ? _ccNestedToolCalls[toolUseId] : null;
      if (isTaskTool) {
        _ccActiveSubagentNames.remove(toolUseId);
        _ccNestedToolCalls.remove(toolUseId);
      }
      return current.copyWith(
        metadata: {
          ...current.metadata,
          ...toolMeta,
          if (nestedCalls != null)
            'nestedToolCalls': nestedCalls
                .map(
                  (tool) => {
                    'name': tool.name,
                    'status': tool.status,
                    'callId': tool.callId,
                    if (tool.output != null) 'output': tool.output,
                  },
                )
                .toList(),
        },
      );
    });
  }

  /// Accumulate a CC file diff into sessionDiffs (sidebar Changes section).
  /// Merges by file path: if the same file is edited again, update its entry.
  void _accumulateCcSessionDiff(
    Map<String, dynamic> toolMeta,
    String toolUseId,
  ) {
    final filediff = toolMeta['filediff'];
    if (filediff is! Map<String, dynamic>) return;

    final file = filediff['file'] as String? ?? '';
    if (file.isEmpty) return;

    final entry = DiffEntry(
      file: file,
      before: filediff['before'] as String? ?? '',
      after: filediff['after'] as String? ?? '',
      additions: (filediff['additions'] as num?)?.toInt() ?? 0,
      deletions: (filediff['deletions'] as num?)?.toInt() ?? 0,
      diff: toolMeta['diff'] as String?,
      partId: toolUseId,
    );

    // Merge: replace existing entry for same file, or append
    final current = List<DiffEntry>.from(state.sessionDiffs);
    final idx = current.indexWhere((d) => d.file == file);
    if (idx >= 0) {
      // Sum additions/deletions from the new edit
      final old = current[idx];
      current[idx] = DiffEntry(
        file: file,
        before: old.before,
        after: entry.after,
        additions: old.additions + entry.additions,
        deletions: old.deletions + entry.deletions,
        diff: entry.diff ?? old.diff,
        partId: entry.partId,
      );
    } else {
      current.add(entry);
    }
    state = state.copyWith(sessionDiffs: current);
  }
}
