import 'dart:async';
import 'dart:developer' as developer;

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/claude_code/cc_terminal_reason.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/question.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/models/session.dart';
import 'package:broski/models/todo.dart';
import 'package:broski/models/vcs.dart';
import 'package:broski/providers/chat/codex_permission_helpers.dart';
import 'package:broski/providers/chat/runtime_common_models.dart';
import 'package:broski/providers/chat/runtime_common_reducer.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/bridge/bridge_runtime.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

part 'chat/cc_stream_handler.dart';
// Split by concern — extracted from this file
part 'chat/chat_session_state.dart';
part 'chat/cx_stream_handler.dart';
part 'chat/message_builder.dart';
part 'chat/oc_stream_handler.dart';
part 'chat/pi_stream_handler.dart';
part 'chat/runtime_cc_metadata_handler.dart';
part 'chat/runtime_cc_system_messages.dart';
// Existing part files
part 'chat/runtime_chat_ingest.dart';
part 'chat/runtime_cx_handlers.dart';
part 'chat/runtime_oc_message_handler.dart';
part 'chat/runtime_oc_part_handler.dart';
part 'chat/runtime_permission_handler.dart';
part 'chat/runtime_system_messages.dart';

class ChatSessionNotifier extends StateNotifier<ChatSessionState> {
  ChatSessionNotifier(this._bridge) : super(const OpenCodeChatState()) {
    _rawSubscription = _bridge.messages.listen(
      (msg) => _handleRawBridgeMessage(msg),
    );
    _initializeRuntimeChatIngest();
  }

  final BridgeService _bridge;
  final Map<String, ChatMessage> _messages = {};
  final List<String> _order = [];
  final Map<String, MessageRole> _rolesByMessageId = {};
  final Map<String, String> _pendingLocalUserTextByMessageId = {};
  final Set<String> _localAuthoredUserMessageIds = {};
  StreamSubscription<Map<String, dynamic>>? _rawSubscription;
  StreamSubscription<RuntimeEvent>? _runtimeEventSubscription;
  StreamSubscription<RuntimeState>? _runtimeStateSubscription;
  final Map<String, RuntimeChatTurnState> _runtimeChatTurns = {};

  final Map<String, int> _lastCcFsNoticeAtMs = {};

  bool _suppressEmit = false;
  bool _pendingEmitMessages = false;

  Timer? _textDebounceTimer;
  final Map<String, StringBuffer> _pendingTextBuffers = {};
  int _lastRttMs = 0;

  // Dedup set for external user messages (runtime_chat_ingest.dart)
  final Set<String> _seenExternalUserMessages = {};

  // Debounce for _projectRuntimeTurn (runtime_chat_ingest.dart)
  Timer? _runtimeProjectionTimer;
  RuntimeChatTurnState? _pendingProjectionTurn;

  // Claude Code subagent tracking
  // Maps Task tool_use_id -> subagent name for running subagents
  final Map<String, String> _ccActiveSubagentNames = {};
  String? _ccFastModeState;
  // Maps parentToolUseId -> list of nested ToolCalls from within that subagent
  final Map<String, List<ToolCall>> _ccNestedToolCalls = {};

  void updateConnectionMetrics(int rttMs) {
    _lastRttMs = rttMs;
  }

  void _flushPendingText(String messageId, ChatMessage baseMessage) {
    final buffer = _pendingTextBuffers[messageId];
    if (buffer == null || buffer.isEmpty) return;

    final pendingText = buffer.toString();
    buffer.clear();

    final existingMessage = _messages[messageId] ?? baseMessage;
    final updated = existingMessage.text + pendingText;
    _updateMessage(
      messageId,
      existingMessage.copyWith(text: updated, isStreaming: true),
    );
  }

  Future<void> replyToPendingQuestion(List<List<String>> answers) async {
    final req = state.pendingQuestion;
    if (req == null || req.id.isEmpty) {
      if (kDebugMode) {
        developer.log(
          'replyToPendingQuestion: No pending question to reply to',
          name: 'ChatProvider',
        );
      }
      return;
    }

    if (kDebugMode) {
      developer.log(
        'replyToPendingQuestion: Sending reply for ${req.id} with ${answers.length} answer(s): $answers',
        name: 'ChatProvider',
      );
    }

    // Clear local state IMMEDIATELY to prevent re-showing the same question.
    state = state.copyWith(pendingQuestion: null);

    // Claude Code AskUserQuestion flow: respond via cc_permission_response with updatedInput.
    if (state.isClaudeCode) {
      final answersMap = <String, String>{};
      for (var i = 0; i < req.questions.length && i < answers.length; i++) {
        final selected = answers[i]
            .map((s) => s.trim())
            .where((s) => s.isNotEmpty)
            .toList();
        if (selected.isEmpty) continue;
        answersMap[req.questions[i].question] = selected.join(', ');
      }

      if (answersMap.isEmpty) {
        _bridge.ccRespondToPermission(
          sessionId: req.sessionId,
          toolUseId: req.id,
          response: 'reject',
        );
        return;
      }

      final questionsPayload = req.questions
          .map(
            (q) => {
              'question': q.question,
              'header': q.header,
              'options': q.options
                  .map((o) => {'label': o.label, 'description': o.description})
                  .toList(),
              'multiSelect': q.multiple,
              'custom': q.custom,
            },
          )
          .toList();

      _bridge.ccRespondToPermission(
        sessionId: req.sessionId,
        toolUseId: req.id,
        response: 'once',
        updatedInput: {'questions': questionsPayload, 'answers': answersMap},
      );
      return;
    }

    // OpenCode Question tool flow.
    try {
      final ok = await _bridge.ocReplyToQuestion(
        requestId: req.id,
        answers: answers,
        projectPath: state.projectPath,
      );

      if (kDebugMode) {
        developer.log(
          'replyToPendingQuestion: Reply result for ${req.id}: $ok',
          name: 'ChatProvider',
        );
      }

      if (!ok) {
        developer.log(
          'WARNING: Question reply may have failed (requestId: ${req.id}). '
          'The AI might re-ask the question.',
          name: 'ChatProvider',
        );
      }
    } catch (e) {
      developer.log(
        'replyToPendingQuestion: Error sending reply for ${req.id}: $e '
        '(answer was already sent on the wire)',
        name: 'ChatProvider',
      );
    }
  }

  Future<void> rejectPendingQuestion() async {
    final req = state.pendingQuestion;
    if (req == null || req.id.isEmpty) {
      if (kDebugMode) {
        developer.log(
          'rejectPendingQuestion: No pending question to reject',
          name: 'ChatProvider',
        );
      }
      return;
    }

    if (kDebugMode) {
      developer.log(
        'rejectPendingQuestion: Rejecting question ${req.id}',
        name: 'ChatProvider',
      );
    }

    // Clear local state IMMEDIATELY (same rationale as replyToPendingQuestion)
    state = state.copyWith(pendingQuestion: null);

    if (state.isClaudeCode) {
      _bridge.ccRespondToPermission(
        sessionId: req.sessionId,
        toolUseId: req.id,
        response: 'reject',
      );
      return;
    }

    try {
      final ok = await _bridge.ocRejectQuestion(
        requestId: req.id,
        projectPath: state.projectPath,
      );

      if (kDebugMode) {
        developer.log(
          'rejectPendingQuestion: Reject result for ${req.id}: $ok',
          name: 'ChatProvider',
        );
      }
    } catch (e) {
      developer.log(
        'rejectPendingQuestion: Error rejecting ${req.id}: $e',
        name: 'ChatProvider',
      );
    }
  }

  @override
  void dispose() {
    _rawSubscription?.cancel();
    _runtimeEventSubscription?.cancel();
    _runtimeStateSubscription?.cancel();
    _textDebounceTimer?.cancel();
    _runtimeProjectionTimer?.cancel();
    super.dispose();
  }
}

final chatSessionProvider =
    StateNotifierProvider<ChatSessionNotifier, ChatSessionState>((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      return ChatSessionNotifier(bridge);
    });
