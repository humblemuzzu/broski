part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

extension _RuntimeClaudeCodeExtensions on ChatSessionNotifier {
  bool _handleRuntimeClaudeCodeCommonMessage(ClaudeCodeStreamMessage message) {
    if (message is CCSessionCreated) {
      final previousSessionId = state.ccSessionId ?? '';
      final nextSessionId = message.sessionId.isNotEmpty
          ? message.sessionId
          : previousSessionId;
      state = state.copyWith(
        ccSessionId: nextSessionId.isNotEmpty
            ? nextSessionId
            : state.ccSessionId,
        ccModel: message.model ?? state.ccModel,
      );
      if (nextSessionId.isNotEmpty && nextSessionId != previousSessionId) {
        _bridge.setView(sessionId: nextSessionId, agent: 'claude-code');
      }
      return true;
    }

    if (message is CCSessionInit) {
      final previousSessionId = state.ccSessionId ?? '';
      final nextSessionId = message.sessionId.isNotEmpty
          ? message.sessionId
          : previousSessionId;
      state = state.copyWith(
        ccSessionId: nextSessionId.isNotEmpty
            ? nextSessionId
            : state.ccSessionId,
        ccModel: message.model.isNotEmpty ? message.model : state.ccModel,
        ccInit: message,
      );
      if (nextSessionId.isNotEmpty && nextSessionId != previousSessionId) {
        _bridge.setView(sessionId: nextSessionId, agent: 'claude-code');
      }
      _emitCcFastModeState(message.fastModeState);
      return true;
    }

    if (message is CCAssistantMessageDelta ||
        message is CCAssistantMessage ||
        message is CCThinkingDelta ||
        message is CCError ||
        message is CCTokenUsage ||
        message is CCStructuredOutput) {
      if (message is CCTokenUsage) {
        state = state.copyWith(ccTokenUsage: message);
      }
      if (message is CCStructuredOutput) {
        state = state.copyWith(ccStructuredOutput: message.data);
      }
      return true;
    }

    if (message is CCSubagentInvocation) {
      if (message.toolUseId != null && message.toolUseId!.isNotEmpty) {
        _ccActiveSubagentNames[message.toolUseId!] = message.subagentName;
        _replaceRuntimeTool(
          AgentType.claudeCode,
          message.toolUseId!,
          (current) => current.copyWith(
            metadata: {
              ...current.metadata,
              'subagentName': message.subagentName,
            },
          ),
        );
      }
      return true;
    }

    if (message is CCToolCall) {
      if (message.tool == 'TodoWrite') {
        _handleCCTodoWrite(message.input);
        return true;
      }

      final toolUseId =
          message.toolUseId ?? 'cc-${DateTime.now().microsecondsSinceEpoch}';
      final input = message.input is Map<String, dynamic>
          ? message.input as Map<String, dynamic>
          : {'input': message.input?.toString() ?? ''};

      if (message.parentToolUseId != null &&
          message.parentToolUseId!.isNotEmpty) {
        final parentId = message.parentToolUseId!;
        final nested = _ccNestedToolCalls.putIfAbsent(parentId, () => []);
        final existingIndex = nested.indexWhere(
          (tool) => tool.callId == toolUseId,
        );
        final nextTool = ToolCall(
          callId: toolUseId,
          partId: toolUseId,
          name: message.tool,
          status: message.status,
          title: message.tool,
          input: input,
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
      return true;
    }

    if (message is CCToolResult) {
      final toolUseId = message.toolUseId;
      if (toolUseId == null || toolUseId.isEmpty) return true;
      final toolMeta = _ccMetadataFromToolUseResult(message.toolUseResult);

      if (message.parentToolUseId != null &&
          message.parentToolUseId!.isNotEmpty) {
        final nested = _ccNestedToolCalls[message.parentToolUseId!];
        if (nested != null) {
          for (var i = 0; i < nested.length; i++) {
            if (nested[i].callId != toolUseId) continue;
            nested[i] = nested[i].copyWith(
              status: 'completed',
              output: message.result?.toString(),
              metadata: {...nested[i].metadata, ...toolMeta},
            );
            break;
          }
        }
        return true;
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
          output: message.result?.toString(),
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
      return true;
    }

    if (message is CCResultComplete) {
      if (message.stopReason == 'refusal') {
        _addMessage(
          ChatMessage(
            id: 'cc-stop-refusal-${DateTime.now().microsecondsSinceEpoch}',
            sessionId: state.ccSessionId ?? '',
            role: MessageRole.system,
            createdAt: DateTime.now(),
            text: '⛔ Claude refused this request.',
            variant: 'cc-stop:refusal',
          ),
        );
      }

      if (message.hasErrorSignal) {
        final subtype = message.subtype ?? 'error_during_execution';
        final label = switch (subtype) {
          'error_max_turns' => 'Reached max turns',
          'error_max_budget_usd' => 'Reached budget limit',
          'error_max_structured_output_retries' =>
            'Structured output retries exceeded',
          _ => 'Execution error',
        };
        final firstError = message.errors.isNotEmpty
            ? ' - ${message.errors.first}'
            : '';
        _addMessage(
          ChatMessage(
            id: 'cc-result-error-${DateTime.now().microsecondsSinceEpoch}',
            sessionId: state.ccSessionId ?? '',
            role: MessageRole.system,
            createdAt: DateTime.now(),
            text: '⚠️ $label$firstError',
            variant: 'cc-result:$subtype',
          ),
        );
      }

      if (message.permissionDenials.isNotEmpty) {
        final deniedTools = message.permissionDenials
            .map((denial) => denial.toolName)
            .where((name) => name.isNotEmpty)
            .toSet()
            .toList();
        if (deniedTools.isNotEmpty) {
          _addMessage(
            ChatMessage(
              id: 'cc-denials-${DateTime.now().microsecondsSinceEpoch}',
              sessionId: state.ccSessionId ?? '',
              role: MessageRole.system,
              createdAt: DateTime.now(),
              text: '🔒 Permission denied: ${deniedTools.join(', ')}',
              variant: 'cc-permission-denials',
            ),
          );
        }
      }

      _emitCcFastModeState(message.fastModeState);
      return true;
    }

    return false;
  }
}
