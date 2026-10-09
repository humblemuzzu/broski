part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// Pi session setup, hydration, and helpers.
/// Extracted from chat_provider.dart.
extension PiStreamHandler on ChatSessionNotifier {
  // ============================================================
  // Pi Session Setup
  // ============================================================

  void setPiSession({
    required String sessionId,
    required String cwd,
    String? model,
    PiThinkingLevel? thinkingLevel,
  }) {
    _messages.clear();
    _order.clear();
    _rolesByMessageId.clear();
    _pendingLocalUserTextByMessageId.clear();
    _localAuthoredUserMessageIds.clear();
    _pendingTextBuffers.clear();
    _runtimeChatTurns.clear();
    _textDebounceTimer?.cancel();
    _textDebounceTimer = null;
    _runtimeProjectionTimer?.cancel();
    _runtimeProjectionTimer = null;
    _pendingProjectionTurn = null;
    _resetCCState();
    state = PiChatState(
      projectPath: cwd,
      piSessionId: sessionId.isEmpty ? null : sessionId,
      piCwd: cwd,
      piModel: model,
      piThinkingLevel: thinkingLevel,
    );
    if (sessionId.isNotEmpty) {
      _bridge.setView(sessionId: sessionId, agent: 'pi');
    }
  }

  void setPiModel(String? model, {PiModel? modelData}) {
    if (!state.isPi) return;
    state = state.copyWith(piModel: model, piModelData: modelData);
  }

  void setPiThinkingLevel(PiThinkingLevel? level) {
    if (!state.isPi) return;
    state = state.copyWith(piThinkingLevel: level);
  }

  void setPiStreaming(bool streaming) {
    if (!state.isPi) return;
    state = state.copyWith(piIsStreaming: streaming);
  }

  /// Hydrate a Pi transcript from raw bridge messages. The durable backend
  /// emits the same message shapes, so it reuses this path with its own id
  /// prefix.
  void hydratePiTranscript(
    List<Map<String, dynamic>> items, {
    String idPrefix = 'pi',
  }) {
    _suppressEmit = true;
    _messages.clear();
    _order.clear();
    _rolesByMessageId.clear();
    _pendingLocalUserTextByMessageId.clear();
    _localAuthoredUserMessageIds.clear();

    // Track the last assistant message ID so we can attach tool results to it
    String? lastAssistantMsgId;

    for (final item in items) {
      final role = item['role'] as String? ?? 'system';
      final timestamp = item['timestamp'] as int?;
      final createdAt = timestamp != null
          ? DateTime.fromMillisecondsSinceEpoch(timestamp)
          : DateTime.now();

      if (role == 'user') {
        lastAssistantMsgId = null;
        final text = item['content'] as String? ?? '';
        final msg = ChatMessage(
          id: '$idPrefix-${_messages.length}',
          sessionId: state.effectiveSessionId ?? '',
          role: MessageRole.user,
          createdAt: createdAt,
          text: text,
        );
        _messages[msg.id] = msg;
        _order.add(msg.id);
      } else if (role == 'assistant') {
        final text = item['text'] as String? ?? '';
        final thinking = item['thinking'] as String?;
        final toolCalls = item['toolCalls'] as List<dynamic>?;

        final tools = <ToolCall>[];
        final orderedParts = <MessagePart>[];
        var partSeq = 0;

        // Build interleaved text + tool parts
        // If there's text before tool calls, add a TextPart
        if (text.trim().isNotEmpty) {
          orderedParts.add(TextPart(sequence: partSeq++, text: text));
        }

        if (toolCalls != null) {
          for (final tc in toolCalls) {
            if (tc is Map<String, dynamic>) {
              final callId = tc['id'] as String? ?? 'tc-$partSeq';
              tools.add(
                ToolCall(
                  partId: callId,
                  callId: callId,
                  name: tc['name'] as String? ?? 'tool',
                  status: 'completed',
                  title: tc['name'] as String? ?? 'tool',
                  input: (tc['arguments'] is Map<String, dynamic>)
                      ? tc['arguments'] as Map<String, dynamic>
                      : {},
                ),
              );
              orderedParts.add(ToolPart(sequence: partSeq++, callId: callId));
            }
          }
        }

        final reasoningParts = <ReasoningPart>[];
        if (thinking != null && thinking.trim().isNotEmpty) {
          final msgId = '$idPrefix-${_messages.length}';
          reasoningParts.add(
            ReasoningPart(
              id: '$idPrefix-thinking-${_messages.length}',
              messageId: msgId,
              text: thinking,
            ),
          );
        }

        final msgId = '$idPrefix-${_messages.length}';
        lastAssistantMsgId = msgId;
        final msg = ChatMessage(
          id: msgId,
          sessionId: state.effectiveSessionId ?? '',
          role: MessageRole.assistant,
          createdAt: createdAt,
          text: text,
          toolCalls: tools,
          reasoningParts: reasoningParts,
          parts: orderedParts,
        );
        _messages[msg.id] = msg;
        _order.add(msg.id);
      } else if (role == 'toolResult') {
        // Attach tool result to the matching tool call in the last assistant message
        final toolCallId = item['toolCallId'] as String? ?? '';
        final content = item['content'] as String? ?? '';
        final isError = item['isError'] as bool? ?? false;
        final details = item['details'];

        if (lastAssistantMsgId != null &&
            _messages.containsKey(lastAssistantMsgId)) {
          final assistantMsg = _messages[lastAssistantMsgId]!;
          final updatedTools = assistantMsg.toolCalls.map((tc) {
            if (tc.callId == toolCallId ||
                (toolCallId.isEmpty &&
                    tc.name == (item['toolName'] as String? ?? ''))) {
              // Build output from result content
              String output = content;

              // If details contain a diff (edit tool), attach it as metadata
              Map<String, dynamic> metadata = tc.metadata;
              if (details is Map<String, dynamic>) {
                final diff = details['diff'] as String?;
                if (diff != null && diff.isNotEmpty) {
                  metadata = {...metadata, 'diff': diff};
                }
              }

              return tc.copyWith(
                status: isError ? 'failed' : 'completed',
                output: output.isNotEmpty ? output : null,
                metadata: metadata,
              );
            }
            return tc;
          }).toList();

          _messages[lastAssistantMsgId] = assistantMsg.copyWith(
            toolCalls: updatedTools,
          );
        }
        // Don't create a separate message for tool results —
        // they are shown inline in the tool card
      } else if (role == 'bashExecution') {
        final bashCard = piBashTranscriptCard(
          item: item,
          id: '$idPrefix-${_messages.length}',
          sessionId: state.effectiveSessionId ?? '',
        );
        if (bashCard != null) {
          _messages[bashCard.id] = bashCard;
          _order.add(bashCard.id);
        }
      } else if (role == 'compactionSummary' || role == 'branchSummary') {
        // Render as a compaction divider
        final msg = ChatMessage(
          id: '$idPrefix-${_messages.length}',
          sessionId: state.effectiveSessionId ?? '',
          role: MessageRole.system,
          createdAt: createdAt,
          text: item['content'] as String? ?? 'Context compacted',
          error: role == 'compactionSummary' ? 'context_compacted' : null,
        );
        _messages[msg.id] = msg;
        _order.add(msg.id);
      }
    }

    _suppressEmit = false;
    _emitMessages();
  }
}
