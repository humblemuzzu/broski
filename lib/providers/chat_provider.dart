import 'dart:async';
import 'dart:developer' as developer;

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/claude_code/cc_terminal_reason.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/question.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/models/session.dart';
import 'package:broski/models/todo.dart';
import 'package:broski/models/transcript_page.dart';
import 'package:broski/providers/chat/runtime_common_models.dart';
import 'package:broski/providers/chat/runtime_common_reducer.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/bridge/bridge_runtime.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

part 'chat/cached_hydration.dart';
part 'chat/cc_stream_handler.dart';
// Split by concern — extracted from this file
part 'chat/chat_session_state.dart';
part 'chat/local_cancel.dart';
part 'chat/message_builder.dart';
part 'chat/runtime_cc_metadata_handler.dart';
part 'chat/runtime_cc_system_messages.dart';
// Existing part files
part 'chat/runtime_chat_ingest.dart';
part 'chat/runtime_permission_handler.dart';
part 'chat/runtime_system_messages.dart';
part 'chat/transcript_message_mappers.dart';
part 'chat/transcript_paging.dart';
part 'chat/transcript_prepend.dart';

class ChatSessionNotifier extends StateNotifier<ChatSessionState> {
  ChatSessionNotifier(this._bridge) : super(const ClaudeCodeChatState()) {
    _rawSubscription = _bridge.messages.listen(
      (msg) => _handleRawBridgeMessage(msg),
    );
    _initializeRuntimeChatIngest();
  }

  final BridgeService _bridge;
  final Map<String, ChatMessage> _messages = {};
  final List<String> _order = [];
  StreamSubscription<Map<String, dynamic>>? _rawSubscription;
  StreamSubscription<RuntimeEvent>? _runtimeEventSubscription;
  StreamSubscription<RuntimeState>? _runtimeStateSubscription;
  final Map<String, RuntimeChatTurnState> _runtimeChatTurns = {};

  final Map<String, int> _lastCcFsNoticeAtMs = {};

  bool _suppressEmit = false;
  bool _pendingEmitMessages = false;

  /// Bridge-opaque cursor for the next older transcript page of the open chat.
  String? _transcriptCursor;

  /// The session that owns [_transcriptCursor]; a page fetched for another session is dropped.
  String? _transcriptSessionId;

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

    _bridge.ccRespondToPermission(
      sessionId: req.sessionId,
      toolUseId: req.id,
      response: 'reject',
    );
  }

  @override
  void dispose() {
    _rawSubscription?.cancel();
    _runtimeEventSubscription?.cancel();
    _runtimeStateSubscription?.cancel();
    _runtimeProjectionTimer?.cancel();
    super.dispose();
  }
}

final chatSessionProvider =
    StateNotifierProvider<ChatSessionNotifier, ChatSessionState>((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      return ChatSessionNotifier(bridge);
    });
