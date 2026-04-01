part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// Claude Code session setup, hydration, and helpers.
/// Extracted from chat_provider.dart.
extension CcStreamHandler on ChatSessionNotifier {
  void _emitCcFastModeState(String? nextState) {
    if (nextState == null || nextState.isEmpty) return;
    if (_ccFastModeState == nextState) return;
    // Do not emit the initial default off state as a visible transition.
    if (_ccFastModeState == null && nextState == 'off') {
      _ccFastModeState = nextState;
      return;
    }
    _ccFastModeState = nextState;
    _addMessage(
      ChatMessage(
        id: 'cc-fast-mode-${DateTime.now().microsecondsSinceEpoch}',
        sessionId: state.ccSessionId ?? '',
        role: MessageRole.system,
        createdAt: DateTime.now(),
        text: '\u26a1 Fast mode: $nextState',
        variant: 'cc-fast-mode:$nextState',
      ),
    );
  }

  /// Set a Claude Code session (instead of OpenCode session)
  void setCCSession({
    required String sessionId,
    required String cwd,
    String? model,
    String? title,
  }) {
    _messages.clear();
    _order.clear();
    _rolesByMessageId.clear();
    _pendingLocalUserTextByMessageId.clear();
    _localAuthoredUserMessageIds.clear();
    _pendingTextBuffers.clear(); // FIX: Clear text buffers for old session
    _runtimeChatTurns.clear();
    _textDebounceTimer?.cancel();
    _textDebounceTimer = null;
    _runtimeProjectionTimer?.cancel();
    _runtimeProjectionTimer = null;
    _pendingProjectionTurn = null;
    _resetCCState();
    state = ClaudeCodeChatState(
      projectPath: cwd,
      ccSessionId: sessionId.isEmpty ? null : sessionId,
      ccCwd: cwd,
      ccModel: model,
    );
    if (sessionId.isNotEmpty) {
      _bridge.setView(sessionId: sessionId, agent: 'claude-code');
    }
  }

  void setCCModel(String? model) {
    if (!state.isClaudeCode) return;
    state = state.copyWith(ccModel: model);
  }

  void _resetCCState() {
    _ccActiveSubagentNames.clear();
    _ccNestedToolCalls.clear();
    _ccFastModeState = null;
  }

  Map<String, dynamic> _ccMetadataFromToolUseResult(dynamic toolUseResult) {
    if (toolUseResult is! Map<String, dynamic>) return const {};

    final metadata = <String, dynamic>{'toolUseResult': toolUseResult};
    final filePath = toolUseResult['filePath'] as String?;
    if (filePath == null || filePath.isEmpty) return metadata;

    final before =
        (toolUseResult['oldString'] as String?) ??
        (toolUseResult['originalFile'] as String?) ??
        '';
    final after =
        (toolUseResult['newString'] as String?) ??
        (toolUseResult['content'] as String?) ??
        '';

    String? diff;
    int additions = 0;
    int deletions = 0;

    final structuredPatch = toolUseResult['structuredPatch'];
    if (structuredPatch is List) {
      final sb = StringBuffer()
        ..writeln('--- a/$filePath')
        ..writeln('+++ b/$filePath');

      for (final hunk in structuredPatch) {
        if (hunk is! Map<String, dynamic>) continue;
        final oldStart = (hunk['oldStart'] as num?)?.toInt() ?? 0;
        final oldLines = (hunk['oldLines'] as num?)?.toInt() ?? 0;
        final newStart = (hunk['newStart'] as num?)?.toInt() ?? 0;
        final newLines = (hunk['newLines'] as num?)?.toInt() ?? 0;
        sb.writeln('@@ -$oldStart,$oldLines +$newStart,$newLines @@');

        final lines = hunk['lines'];
        if (lines is List) {
          for (final line in lines) {
            if (line is! String) continue;
            if (line.startsWith('+') && !line.startsWith('+++')) additions++;
            if (line.startsWith('-') && !line.startsWith('---')) deletions++;
            sb.writeln(line);
          }
        }
      }

      diff = sb.toString().trimRight();
    }

    metadata['filediff'] = {
      'file': filePath,
      'before': before,
      'after': after,
      'additions': additions,
      'deletions': deletions,
    };
    if (diff != null && diff.trim().isNotEmpty) metadata['diff'] = diff;

    return metadata;
  }

  /// Hydrate chat with Claude Code transcript messages from the bridge.
  void hydrateClaudeCodeTranscript(List<Map<String, dynamic>> items) {
    _messages.clear();
    _order.clear();
    _resetCCState();

    state = state.copyWith(
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
      ccIsStreaming: false,
    );

    _suppressEmit = true;
    _pendingEmitMessages = false;

    try {
      for (final item in items) {
        final id = item['id'] as String? ?? '';
        final role = item['role'] as String? ?? 'assistant';
        final createdAtMs = item['createdAt'] as int? ?? 0;
        final text = item['text'] as String? ?? '';
        if (id.isEmpty) continue;

        final thinking = item['thinking'] as String?;
        final toolCallsRaw = item['toolCalls'];
        final diffsRaw = item['diffs'];

        final reasoningParts = <ReasoningPart>[];
        if (thinking != null && thinking.trim().isNotEmpty) {
          reasoningParts.add(
            ReasoningPart(
              id: 'cc-thinking-$id',
              messageId: id,
              text: thinking,
              isStreaming: false,
            ),
          );
        }

        final tools = <ToolCall>[];
        if (toolCallsRaw is List) {
          for (final t in toolCallsRaw) {
            if (t is! Map<String, dynamic>) continue;
            final toolUseId = t['toolUseId'] as String? ?? '';
            if (toolUseId.isEmpty) continue;
            final toolName = t['tool'] as String? ?? 'tool';
            final input = t['input'];
            final status = t['status'] as String? ?? 'completed';
            final output = t['output'] as String?;
            final metaRaw = t['metadata'];
            final metadata = metaRaw is Map<String, dynamic>
                ? metaRaw
                : const <String, dynamic>{};

            tools.add(
              ToolCall(
                callId: toolUseId,
                partId: toolUseId,
                name: toolName,
                status: status,
                title: toolName,
                input: input is Map<String, dynamic>
                    ? input
                    : {'input': input?.toString() ?? ''},
                output: output,
                metadata: metadata,
              ),
            );
          }
        }

        final diffs = <DiffEntry>[];
        if (diffsRaw is List) {
          for (final d in diffsRaw) {
            if (d is! Map<String, dynamic>) continue;
            final file = d['file'] as String? ?? '';
            if (file.isEmpty) continue;
            diffs.add(
              DiffEntry(
                file: file,
                before: d['before'] as String? ?? '',
                after: d['after'] as String? ?? '',
                additions: d['additions'] as int? ?? 0,
                deletions: d['deletions'] as int? ?? 0,
                diff: d['diff'] as String?,
                partId: d['partId'] as String?,
                status: d['status'] as String?,
              ),
            );
          }
        }

        final message = ChatMessage(
          id: id,
          sessionId: state.ccSessionId ?? '',
          role: switch (role) {
            'user' => MessageRole.user,
            'assistant' => MessageRole.assistant,
            _ => MessageRole.system,
          },
          createdAt: DateTime.fromMillisecondsSinceEpoch(createdAtMs),
          text: text,
          toolCalls: tools,
          diffs: diffs,
          reasoningParts: reasoningParts,
          isStreaming: false,
        );

        _addMessage(message);
      }
    } finally {
      _suppressEmit = false;
      if (_pendingEmitMessages) {
        _emitMessages();
      }
    }
  }

  /// Handle TodoWrite tool calls from Claude Code
  /// Parses the todos list from input and updates state
  void _handleCCTodoWrite(dynamic input) {
    if (input is! Map<String, dynamic>) return;
    final todosRaw = input['todos'];
    if (todosRaw is! List) return;

    final todos = <Todo>[];
    for (final item in todosRaw) {
      if (item is Map<String, dynamic>) {
        todos.add(Todo.fromJson(item));
      }
    }

    if (todos.isNotEmpty) {
      state = state.copyWith(todos: todos);
    }
  }

  /// Set CC streaming state (called when sending a message)
  void setCCStreaming(bool isStreaming) {
    state = state.copyWith(ccIsStreaming: isStreaming);
  }

  /// Queue a message for auto-send when the CC turn completes.
  /// Called when user sends while CC is streaming.
  void setPendingCCMessage(String? text, {List<FileAttachment>? attachments}) {
    if (text == null || text.isEmpty) {
      clearPendingCCMessage();
      return;
    }
    state = state.copyWith(
      pendingCCMessage: text,
      pendingCCAttachments: attachments,
    );
  }

  /// Clear the pending CC message queue (called on cancel or after auto-send).
  void clearPendingCCMessage() {
    if (state.pendingCCMessage == null && state.pendingCCAttachments == null) {
      return;
    }
    state = state.copyWith(pendingCCMessage: null, pendingCCAttachments: null);
  }

  void _handleRawBridgeMessage(Map<String, dynamic> msg) {
    if (!state.isClaudeCode) return;
    if (msg['type'] != 'cc_fs_changed') return;
    final data = msg['data'];
    if (data is! Map) return;

    final kind = data['kind']?.toString() ?? '';
    if (kind.isEmpty) return;

    final cwd = data['cwd']?.toString();
    final activeCwd = state.ccCwd ?? '';
    if (cwd != null &&
        cwd.isNotEmpty &&
        activeCwd.isNotEmpty &&
        cwd != activeCwd) {
      return;
    }

    final now = DateTime.now().millisecondsSinceEpoch;
    final key = '$kind:${cwd ?? ''}';
    final last = _lastCcFsNoticeAtMs[key] ?? 0;
    if (now - last < 1500) return;
    _lastCcFsNoticeAtMs[key] = now;

    final file = data['file']?.toString();
    final suffix = (file != null && file.isNotEmpty) ? ': $file' : '';
    final text = switch (kind) {
      'mcp' =>
        'MCP config changed$suffix. New tools apply on next session start.',
      'skills' => 'Skills changed$suffix. Refresh the Skills screen if needed.',
      'plugins' =>
        'Plugins changed$suffix. New capabilities apply on next session start.',
      'commands' => 'Commands changed$suffix.',
      'hooks' => 'Hooks changed$suffix.',
      _ => 'Claude Code files changed$suffix.',
    };

    final sys = ChatMessage(
      id: 'cc-fs-$kind-$now',
      sessionId: state.ccSessionId ?? '',
      role: MessageRole.system,
      createdAt: DateTime.now(),
      text: text,
    );
    _addMessage(sys);
  }
}
