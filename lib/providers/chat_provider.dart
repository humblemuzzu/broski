import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/file_attachment.dart';
import '../models/agent_type.dart';
import '../models/message.dart';
import '../models/pi.dart';
import '../models/question.dart';
import '../models/runtime/runtime.dart';
import '../models/session.dart';
import '../models/todo.dart';
import '../models/vcs.dart';
import '../services/bridge/bridge_runtime.dart';
import 'chat/runtime_common_models.dart';
import 'chat/codex_permission_helpers.dart';
import 'chat/runtime_common_reducer.dart';
import 'service_providers.dart';

part 'chat/runtime_chat_ingest.dart';
part 'chat/runtime_system_messages.dart';
part 'chat/runtime_cc_system_messages.dart';
part 'chat/runtime_cc_metadata_handler.dart';
part 'chat/runtime_oc_message_handler.dart';
part 'chat/runtime_oc_part_handler.dart';
part 'chat/runtime_cx_handlers.dart';
part 'chat/runtime_permission_handler.dart';

/// MCP OAuth pending state (SDK v1.1.23+)
/// When MCP OAuth browser open fails (headless/remote), we store the URL
/// for the user to manually open.
class McpOAuthPending {
  const McpOAuthPending({required this.serverName, required this.url});
  final String serverName;
  final String url;
}

class ChatSessionState {
  const ChatSessionState({
    this.session,
    this.projectPath,
    this.messages = const [],
    this.permissions = const [],
    this.sessionDiffs = const [],
    this.todos = const [],
    this.vcsInfo,
    this.isCompacting = false,
    this.sessionStatus =
        const SessionStatus.idle(), // Feature 13: Session status
    // Claude Code support
    this.isClaudeCode = false,
    this.ccSessionId,
    this.ccCwd,
    this.ccModel,
    this.ccInit,
    this.ccTokenUsage,
    this.ccStructuredOutput,
    this.ccIsStreaming = false,
    // Codex support
    this.isCodex = false,
    this.cxThreadId,
    this.cxCwd,
    this.cxModel,
    this.cxTokenUsage,
    this.cxIsStreaming = false,
    // Codex multi-agent collaboration tree (SDK v0.87.0+)
    this.cxCollabTree,
    // Codex request_user_input (SDK v0.87.0+)
    this.cxPendingUserInput,
    this.pendingQuestion,
    // FIX: Track content length incrementally instead of recalculating every frame
    this.contentLength = 0,
    // OpenCode Plan Mode (SDK v1.1.18+)
    // "build" = default mode for making changes
    // "plan" = research/planning mode (restricted file edits)
    this.ocAgentMode = 'build',
    // OpenCode MCP OAuth pending (SDK v1.1.23+)
    this.mcpOAuthPending,
    // Claude Code client-side message queue
    // When CC is streaming and user sends, we hold the message locally
    // and auto-send when the turn completes (ccIsStreaming → false).
    this.pendingCCMessage,
    this.pendingCCAttachments,
    // Pi support
    this.isPi = false,
    this.piSessionId,
    this.piCwd,
    this.piModel,
    this.piModelData,
    this.piThinkingLevel,
    this.piIsStreaming = false,
  });

  final SessionSummary? session;
  final String? projectPath;
  final List<ChatMessage> messages;
  final List<PermissionRequest> permissions;
  final List<DiffEntry> sessionDiffs;
  final List<Todo> todos;
  final VcsInfo? vcsInfo; // Feature 10: Git branch info
  final bool isCompacting; // Feature 9: Compaction in progress
  final SessionStatus
  sessionStatus; // Feature 13: Session status (idle/busy/retry)

  // Claude Code support
  final bool isClaudeCode;
  final String? ccSessionId;
  final String? ccCwd;
  final String? ccModel;
  final CCSessionInit? ccInit;
  final CCTokenUsage? ccTokenUsage;
  final dynamic ccStructuredOutput;
  final bool ccIsStreaming;

  // Codex support
  final bool isCodex;
  final String? cxThreadId;
  final String? cxCwd;
  final String? cxModel;
  final CodexThreadTokenUsage? cxTokenUsage;
  final bool cxIsStreaming;
  // Codex multi-agent collaboration tree (SDK v0.87.0+)
  final CodexCollabAgentTree? cxCollabTree;
  // Codex request_user_input (SDK v0.87.0+)
  final CodexUserInputRequest? cxPendingUserInput;

  // OpenCode Question tool support
  final QuestionRequest? pendingQuestion;

  // FIX: Pre-computed content length for efficient auto-scroll detection
  final int contentLength;

  // OpenCode Plan Mode (SDK v1.1.18+)
  // "build" = default mode for making changes
  // "plan" = research/planning mode (restricted file edits)
  final String ocAgentMode;

  // OpenCode MCP OAuth pending (SDK v1.1.23+)
  // When MCP OAuth browser open fails in headless mode, URL stored here
  final McpOAuthPending? mcpOAuthPending;

  // Claude Code client-side message queue
  // Held locally while CC is streaming, auto-sent when turn completes.
  final String? pendingCCMessage;
  final List<FileAttachment>? pendingCCAttachments;

  // Pi support
  final bool isPi;
  final String? piSessionId;
  final String? piCwd;
  final String? piModel;
  final PiModel? piModelData;
  final PiThinkingLevel? piThinkingLevel;
  final bool piIsStreaming;

  /// Get the effective session ID (works for all backends)
  String? get effectiveSessionId => isClaudeCode
      ? ccSessionId
      : isCodex
      ? cxThreadId
      : isPi
      ? piSessionId
      : session?.id;

  /// Get the effective project path (works for all backends)
  String? get effectivePath => isClaudeCode
      ? ccCwd
      : isCodex
      ? cxCwd
      : isPi
      ? piCwd
      : projectPath;

  ChatSessionState copyWith({
    SessionSummary? session,
    String? projectPath,
    List<ChatMessage>? messages,
    List<PermissionRequest>? permissions,
    List<DiffEntry>? sessionDiffs,
    List<Todo>? todos,
    VcsInfo? vcsInfo,
    bool? isCompacting,
    SessionStatus? sessionStatus,
    bool? isClaudeCode,
    String? ccSessionId,
    String? ccCwd,
    String? ccModel,
    CCSessionInit? ccInit,
    CCTokenUsage? ccTokenUsage,
    dynamic ccStructuredOutput,
    bool? ccIsStreaming,
    bool? isCodex,
    String? cxThreadId,
    String? cxCwd,
    String? cxModel,
    CodexThreadTokenUsage? cxTokenUsage,
    bool? cxIsStreaming,
    CodexCollabAgentTree? cxCollabTree,
    CodexUserInputRequest? cxPendingUserInput,
    QuestionRequest? pendingQuestion,
    int? contentLength,
    String? ocAgentMode,
    McpOAuthPending? mcpOAuthPending,
    String? pendingCCMessage,
    List<FileAttachment>? pendingCCAttachments,
    bool? isPi,
    String? piSessionId,
    String? piCwd,
    String? piModel,
    PiModel? piModelData,
    PiThinkingLevel? piThinkingLevel,
    bool? piIsStreaming,
  }) {
    return ChatSessionState(
      session: session ?? this.session,
      projectPath: projectPath ?? this.projectPath,
      messages: messages ?? this.messages,
      permissions: permissions ?? this.permissions,
      sessionDiffs: sessionDiffs ?? this.sessionDiffs,
      todos: todos ?? this.todos,
      vcsInfo: vcsInfo ?? this.vcsInfo,
      isCompacting: isCompacting ?? this.isCompacting,
      sessionStatus: sessionStatus ?? this.sessionStatus,
      isClaudeCode: isClaudeCode ?? this.isClaudeCode,
      ccSessionId: ccSessionId ?? this.ccSessionId,
      ccCwd: ccCwd ?? this.ccCwd,
      ccModel: ccModel ?? this.ccModel,
      ccInit: ccInit ?? this.ccInit,
      ccTokenUsage: ccTokenUsage ?? this.ccTokenUsage,
      ccStructuredOutput: ccStructuredOutput ?? this.ccStructuredOutput,
      ccIsStreaming: ccIsStreaming ?? this.ccIsStreaming,
      isCodex: isCodex ?? this.isCodex,
      cxThreadId: cxThreadId ?? this.cxThreadId,
      cxCwd: cxCwd ?? this.cxCwd,
      cxModel: cxModel ?? this.cxModel,
      cxTokenUsage: cxTokenUsage ?? this.cxTokenUsage,
      cxIsStreaming: cxIsStreaming ?? this.cxIsStreaming,
      cxCollabTree: cxCollabTree ?? this.cxCollabTree,
      cxPendingUserInput: cxPendingUserInput ?? this.cxPendingUserInput,
      pendingQuestion: pendingQuestion ?? this.pendingQuestion,
      contentLength: contentLength ?? this.contentLength,
      ocAgentMode: ocAgentMode ?? this.ocAgentMode,
      mcpOAuthPending: mcpOAuthPending ?? this.mcpOAuthPending,
      pendingCCMessage: pendingCCMessage ?? this.pendingCCMessage,
      pendingCCAttachments: pendingCCAttachments ?? this.pendingCCAttachments,
      isPi: isPi ?? this.isPi,
      piSessionId: piSessionId ?? this.piSessionId,
      piCwd: piCwd ?? this.piCwd,
      piModel: piModel ?? this.piModel,
      piModelData: piModelData ?? this.piModelData,
      piThinkingLevel: piThinkingLevel ?? this.piThinkingLevel,
      piIsStreaming: piIsStreaming ?? this.piIsStreaming,
    );
  }
}

class ChatSessionNotifier extends StateNotifier<ChatSessionState> {
  ChatSessionNotifier(this._bridge) : super(const ChatSessionState()) {
    _rawSubscription = _bridge.messages.listen(_handleRawBridgeMessage);
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

  /// Rehydrate pending OpenCode permission/question prompts after reconnect.
  /// This prevents sessions from getting stuck if events were missed.
  Future<void> rehydrateOpenCodePending({required String projectPath}) async {
    final sessionId = state.session?.id;
    if (sessionId == null || sessionId.isEmpty) return;

    try {
      final pendingPerms = await _bridge.listPendingPermissions(
        projectPath: projectPath,
      );

      final existingIds = state.permissions.map((p) => p.id).toSet();
      final nextPerms = <PermissionRequest>[...state.permissions];

      for (final item in pendingPerms) {
        final sid =
            (item['sessionID'] as String?) ??
            (item['sessionId'] as String?) ??
            '';
        if (sid != sessionId) continue;

        final id = item['id'] as String? ?? '';
        if (id.isEmpty || existingIds.contains(id)) continue;

        final toolData = item['tool'] as Map<String, dynamic>?;
        final tool = toolData != null ? ToolReference.fromJson(toolData) : null;

        final patterns =
            (item['patterns'] as List<dynamic>?)
                ?.map((e) => e.toString())
                .toList() ??
            const <String>[];
        final always =
            (item['always'] as List<dynamic>?)
                ?.map((e) => e.toString())
                .toList() ??
            const <String>[];

        nextPerms.add(
          PermissionRequest(
            id: id,
            sessionId: sid,
            title: item['title'] as String? ?? 'Permission required',
            permission: item['permission'] as String?,
            patterns: patterns,
            always: always,
            tool: tool,
            command:
                (item['metadata'] as Map<String, dynamic>?)?['command']
                    as String?,
            metadata: item['metadata'] as Map<String, dynamic>? ?? const {},
          ),
        );
        existingIds.add(id);
      }

      if (nextPerms.length != state.permissions.length) {
        state = state.copyWith(permissions: nextPerms);
      }
    } catch (_) {
      // Best-effort only.
    }

    try {
      final pendingQs = await _bridge.listPendingQuestions(
        projectPath: projectPath,
      );
      if (state.pendingQuestion != null) return;

      for (final item in pendingQs) {
        final req = QuestionRequest.fromJson(item);
        if (req.id.isEmpty) continue;
        if (req.sessionId != sessionId) continue;

        state = state.copyWith(pendingQuestion: req);
        break;
      }
    } catch (_) {
      // Best-effort only.
    }
  }

  /// Reply to a Codex request_user_input (SDK v0.87.0+)
  /// [answers] is indexed by question position, matching the UI's output format.
  /// Protocol shape: { answers: { questionId: { answers: string[] } } }
  void replyToCodexUserInput(List<List<String>> answers) {
    final req = state.cxPendingUserInput;
    if (req == null || req.requestId.isEmpty) return;

    // Convert List<List<String>> to Map<questionId, {answers: [...]}>
    // Protocol: ToolRequestUserInputResponse = { answers: { [questionId]: ToolRequestUserInputAnswer } }
    // where ToolRequestUserInputAnswer = { answers: string[] }
    final answersMap = <String, Map<String, dynamic>>{};
    for (var i = 0; i < req.questions.length && i < answers.length; i++) {
      final questionId = req.questions[i].id;
      final selected = answers[i].where((s) => s.trim().isNotEmpty).toList();
      answersMap[questionId] = {'answers': selected};
    }

    _bridge.cxRespondToUserInput(requestId: req.requestId, answers: answersMap);
    _clearCxPendingUserInput();
  }

  /// Dismiss/reject a Codex request_user_input (SDK v0.87.0+)
  void rejectCodexUserInput() {
    final req = state.cxPendingUserInput;
    if (req == null || req.requestId.isEmpty) return;

    // Send empty answers to dismiss
    // Protocol: ToolRequestUserInputAnswer = { answers: string[] }
    final answersMap = <String, Map<String, dynamic>>{};
    for (final q in req.questions) {
      answersMap[q.id] = {'answers': <String>[]};
    }

    _bridge.cxRespondToUserInput(requestId: req.requestId, answers: answersMap);
    _clearCxPendingUserInput();
  }

  /// Helper to explicitly clear cxPendingUserInput (copyWith can't set null)
  void _clearCxPendingUserInput() {
    state = ChatSessionState(
      session: state.session,
      projectPath: state.projectPath,
      messages: state.messages,
      permissions: state.permissions,
      sessionDiffs: state.sessionDiffs,
      todos: state.todos,
      vcsInfo: state.vcsInfo,
      isCompacting: state.isCompacting,
      sessionStatus: state.sessionStatus,
      isClaudeCode: state.isClaudeCode,
      ccSessionId: state.ccSessionId,
      ccCwd: state.ccCwd,
      ccModel: state.ccModel,
      ccInit: state.ccInit,
      ccTokenUsage: state.ccTokenUsage,
      ccStructuredOutput: state.ccStructuredOutput,
      ccIsStreaming: state.ccIsStreaming,
      isCodex: state.isCodex,
      cxThreadId: state.cxThreadId,
      cxCwd: state.cxCwd,
      cxModel: state.cxModel,
      cxTokenUsage: state.cxTokenUsage,
      cxIsStreaming: state.cxIsStreaming,
      cxCollabTree: state.cxCollabTree,
      cxPendingUserInput: null, // Explicitly cleared
      pendingQuestion: state.pendingQuestion,
      contentLength: state.contentLength,
      ocAgentMode: state.ocAgentMode,
      mcpOAuthPending: state.mcpOAuthPending,
      pendingCCMessage: state.pendingCCMessage,
      pendingCCAttachments: state.pendingCCAttachments,
      isPi: state.isPi,
      piSessionId: state.piSessionId,
      piCwd: state.piCwd,
      piModel: state.piModel,
      piModelData: state.piModelData,
      piThinkingLevel: state.piThinkingLevel,
      piIsStreaming: state.piIsStreaming,
    );
  }

  String _normalizeUserText(String text) {
    return text.trim().replaceAll(RegExp(r'\s+'), ' ');
  }

  bool _isTextMatch(String a, String b) {
    if (a.isEmpty || b.isEmpty) return false;
    if (a == b) return true;
    return a.startsWith(b) || b.startsWith(a);
  }

  String? _findPendingLocalUserMessageId({
    required String sessionId,
    required String candidateText,
  }) {
    final normalizedCandidate = _normalizeUserText(candidateText);
    if (normalizedCandidate.isEmpty) return null;

    String? matchId;
    for (final entry in _pendingLocalUserTextByMessageId.entries) {
      final localId = entry.key;
      final localMsg = _messages[localId];
      if (localMsg == null) continue;
      if (localMsg.sessionId != sessionId) continue;
      if (localMsg.role != MessageRole.user) continue;
      // Accept both local-xxx (no messageId supplied) and msg_xxx (client-
      // generated OpenCode IDs) — any ID in _pendingLocalUserTextByMessageId
      // is an optimistic local message awaiting reconciliation.
      if (_isTextMatch(entry.value, normalizedCandidate)) {
        matchId = localId; // keep last match (most recent insertion order)
      }
    }
    return matchId;
  }

  ChatMessage _copyWithRole(ChatMessage message, MessageRole role) {
    return ChatMessage(
      id: message.id,
      sessionId: message.sessionId,
      role: role,
      createdAt: message.createdAt,
      text: message.text,
      toolCalls: message.toolCalls,
      diffs: message.diffs,
      subtaskNotifications: message.subtaskNotifications,
      reasoningParts: message.reasoningParts,
      parts: message.parts,
      isStreaming: message.isStreaming,
      error: message.error,
    );
  }

  void _reconcileLocalUserMessage({
    required String localMessageId,
    required String serverMessageId,
    required String sessionId,
  }) {
    final localMsg = _messages[localMessageId];
    if (localMsg == null) return;

    final localIndex = _order.indexOf(localMessageId);
    _messages.remove(localMessageId);
    if (localIndex >= 0) {
      _order.removeAt(localIndex);
    }
    _pendingLocalUserTextByMessageId.remove(localMessageId);
    _localAuthoredUserMessageIds.remove(localMessageId);

    final existingServer = _messages[serverMessageId];
    if (existingServer == null) {
      _messages[serverMessageId] = ChatMessage(
        id: serverMessageId,
        sessionId: sessionId,
        role: MessageRole.user,
        createdAt: localMsg.createdAt,
        text: localMsg.text,
        toolCalls: localMsg.toolCalls,
        diffs: localMsg.diffs,
        subtaskNotifications: localMsg.subtaskNotifications,
        reasoningParts: localMsg.reasoningParts,
        parts: localMsg.parts,
        isStreaming: false,
        error: localMsg.error,
      );
    }

    final existingIndex = _order.indexOf(serverMessageId);
    if (existingIndex >= 0) {
      _order.removeAt(existingIndex);
    }
    final insertIndex = localIndex >= 0
        ? localIndex.clamp(0, _order.length).toInt()
        : _order.length;
    _order.insert(insertIndex, serverMessageId);

    if (_suppressEmit) {
      _pendingEmitMessages = true;
    } else {
      _emitMessages();
    }
  }

  // Claude Code subagent tracking
  // Maps Task tool_use_id -> subagent name for running subagents
  final Map<String, String> _ccActiveSubagentNames = {};
  String? _ccFastModeState;
  // Maps parentToolUseId -> list of nested ToolCalls from within that subagent
  final Map<String, List<ToolCall>> _ccNestedToolCalls = {};

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
        text: '⚡ Fast mode: $nextState',
        variant: 'cc-fast-mode:$nextState',
      ),
    );
  }

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

  void setSession(SessionSummary session, {String? projectPath}) {
    _messages.clear();
    _order.clear();
    _rolesByMessageId.clear();
    _pendingLocalUserTextByMessageId.clear();
    _localAuthoredUserMessageIds.clear();
    _pendingTextBuffers.clear(); // FIX: Clear text buffers for old session
    _runtimeChatTurns.clear();
    _textDebounceTimer?.cancel();
    _textDebounceTimer = null;
    _resetCCState();
    state = ChatSessionState(
      session: session,
      projectPath: projectPath,
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
      todos: const [],
      isClaudeCode: false,
      isCodex: false,
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
    _resetCCState();
    state = ChatSessionState(
      session: null,
      projectPath: cwd,
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
      todos: const [],
      isClaudeCode: true,
      isCodex: false,
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

  /// Set OpenCode agent mode ("build" or "plan")
  /// Used for manual toggling from UI or when plan_enter/plan_exit tools complete
  void setOCAgentMode(String mode) {
    if (state.isClaudeCode || state.isCodex) return;
    final validMode = (mode == 'plan') ? 'plan' : 'build';
    state = state.copyWith(ocAgentMode: validMode);
  }

  void setCodexThread({
    required String threadId,
    required String cwd,
    String? model,
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
    _resetCCState();
    state = ChatSessionState(
      session: null,
      projectPath: cwd,
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
      todos: const [],
      isClaudeCode: false,
      isCodex: true,
      cxThreadId: threadId.isEmpty ? null : threadId,
      cxCwd: cwd,
      cxModel: model,
      cxTokenUsage: null,
      cxIsStreaming: false,
    );
    if (threadId.isNotEmpty) {
      _bridge.setView(sessionId: threadId, agent: 'codex');
    }
  }

  void setCodexModel(String? model) {
    if (!state.isCodex) return;
    state = state.copyWith(cxModel: model);
  }

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
    _resetCCState();
    state = ChatSessionState(
      session: null,
      projectPath: cwd,
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
      todos: const [],
      isClaudeCode: false,
      isCodex: false,
      isPi: true,
      piSessionId: sessionId.isEmpty ? null : sessionId,
      piCwd: cwd,
      piModel: model,
      piThinkingLevel: thinkingLevel,
      piIsStreaming: false,
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

  /// Hydrate Pi transcript from raw bridge messages
  void hydratePiTranscript(List<Map<String, dynamic>> items) {
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
          id: 'pi-${_messages.length}',
          sessionId: state.piSessionId ?? '',
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
          final msgId = 'pi-${_messages.length}';
          reasoningParts.add(
            ReasoningPart(
              id: 'pi-thinking-${_messages.length}',
              messageId: msgId,
              text: thinking,
            ),
          );
        }

        final msgId = 'pi-${_messages.length}';
        lastAssistantMsgId = msgId;
        final msg = ChatMessage(
          id: msgId,
          sessionId: state.piSessionId ?? '',
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
      } else if (role == 'compactionSummary' || role == 'branchSummary') {
        // Render as a compaction divider
        final msg = ChatMessage(
          id: 'pi-${_messages.length}',
          sessionId: state.piSessionId ?? '',
          role: MessageRole.system,
          createdAt: createdAt,
          text: item['content'] as String? ?? 'Context compacted',
          error: role == 'compactionSummary' ? 'context_compacted' : null,
        );
        _messages[msg.id] = msg;
        _order.add(msg.id);
      }
      // Skip bashExecution and custom roles — they don't need separate rendering
    }

    _suppressEmit = false;
    _emitMessages();
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

  /// Hydrate chat with Codex transcript messages from the bridge.
  void hydrateCodexTranscript(List<CodexTranscriptMessage> items) {
    _messages.clear();
    _order.clear();

    state = state.copyWith(
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
      cxIsStreaming: false,
    );

    _suppressEmit = true;
    _pendingEmitMessages = false;

    try {
      for (final item in items) {
        final id = item.id;
        if (id.isEmpty) continue;

        final role = switch (item.role) {
          'user' => MessageRole.user,
          'system' => MessageRole.system,
          _ => MessageRole.assistant,
        };

        final createdAt = DateTime.fromMillisecondsSinceEpoch(
          item.createdAt * 1000,
        );

        final reasoningParts = <ReasoningPart>[];
        if ((item.thinking ?? '').trim().isNotEmpty) {
          reasoningParts.add(
            ReasoningPart(
              id: 'cx-thinking-$id',
              messageId: id,
              text: item.thinking ?? '',
              isStreaming: false,
            ),
          );
        }

        final tools = <ToolCall>[
          for (final t in item.toolCalls)
            ToolCall(
              callId: t.itemId,
              partId: t.itemId,
              name: t.name,
              status: t.status,
              title: t.name,
              input: t.input ?? const <String, dynamic>{},
              output: t.output,
              metadata: t.metadata ?? const <String, dynamic>{},
            ),
        ];

        final diffs = <DiffEntry>[
          for (final d in item.diffs)
            DiffEntry(
              file: d.file,
              before: '',
              after: '',
              additions: d.additions,
              deletions: d.deletions,
              diff: d.diff,
              partId: d.itemId,
            ),
        ];

        final message = ChatMessage(
          id: id,
          sessionId: state.cxThreadId ?? '',
          role: role,
          createdAt: createdAt,
          text: item.text,
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

  void hydrate(List<dynamic> rawMessages) {
    _messages.clear();
    _order.clear();
    state = state.copyWith(
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
    );

    for (final item in rawMessages) {
      final map = item as Map<String, dynamic>;
      final info = map['info'] as Map<String, dynamic>? ?? const {};
      final parts = map['parts'] as List<dynamic>? ?? const [];
      final messageId = info['id'] as String? ?? '';
      final sessionId =
          info['sessionID'] as String? ?? info['sessionId'] as String? ?? '';
      final role = info['role'] as String? ?? 'assistant';
      final created =
          info['time']?['created'] as int? ??
          DateTime.now().millisecondsSinceEpoch;

      if (messageId.isEmpty) continue;

      var textBuffer = StringBuffer();
      final tools = <ToolCall>[];
      final diffs = <DiffEntry>[];
      final subtasks = <SubtaskNotification>[];
      final reasoningParts = <ReasoningPart>[];

      for (final partItem in parts) {
        final part = partItem as Map<String, dynamic>;
        final partType = part['type'] as String? ?? '';
        if (partType == 'text') {
          // Skip synthetic and ignored text parts (system-injected content)
          // OpenCode TUI does the same filtering
          final isSynthetic = part['synthetic'] as bool? ?? false;
          final isIgnored = part['ignored'] as bool? ?? false;
          if (!isSynthetic && !isIgnored) {
            textBuffer.write(part['text'] as String? ?? '');
          }
        }
        if (partType == 'tool') {
          final partId = part['id'] as String? ?? '';
          final callId =
              part['callID'] as String? ??
              part['callId'] as String? ??
              part['call_id'] as String? ??
              '';
          final toolName = part['tool'] as String? ?? 'tool';
          final stateInfo = part['state'] as Map<String, dynamic>? ?? const {};
          final status = stateInfo['status'] as String? ?? 'completed';
          final title = stateInfo['title'] as String?;
          final input = stateInfo['input'] as Map<String, dynamic>? ?? const {};
          final output = stateInfo['output'] as String?;
          final metadataRaw = stateInfo['metadata'];
          final metadata = metadataRaw is Map<String, dynamic>
              ? metadataRaw
              : const <String, dynamic>{};
          if (callId.isNotEmpty) {
            final tool = ToolCall(
              callId: callId,
              partId: partId.isNotEmpty ? partId : callId,
              name: toolName,
              status: status,
              title: title,
              input: input,
              output: output,
              metadata: metadata,
            );
            tools.add(tool);

            final diff = _extractDiffFromTool(tool);
            if (diff != null) {
              diffs.add(diff);
            }
          }
        }
        // Parse subtask notifications (background task completions)
        if (partType == 'subtask') {
          subtasks.add(SubtaskNotification.fromJson(part));
        }
        // Parse reasoning parts (model thinking content)
        if (partType == 'reasoning') {
          reasoningParts.add(ReasoningPart.fromJson(part));
        }
      }

      final textContent = textBuffer.toString();

      // Skip user messages that have no visible content after filtering synthetic parts
      // (these are system-injected context messages, not real user input)
      if (role == 'user' && textContent.isEmpty && tools.isEmpty) {
        continue;
      }

      final message = ChatMessage(
        id: messageId,
        sessionId: sessionId,
        role: role == 'user' ? MessageRole.user : MessageRole.assistant,
        createdAt: DateTime.fromMillisecondsSinceEpoch(created),
        text: textContent,
        toolCalls: tools,
        diffs: diffs,
        subtaskNotifications: subtasks,
        reasoningParts: reasoningParts,
      );

      _addMessage(message);
    }
  }

  String appendUserMessage(String content, {String? messageId}) {
    // Handle Claude Code mode
    if (state.isClaudeCode) {
      final sessionId = state.ccSessionId ?? '';
      final id = messageId ?? 'local-${DateTime.now().microsecondsSinceEpoch}';
      final message = ChatMessage(
        id: id,
        sessionId: sessionId,
        role: MessageRole.user,
        createdAt: DateTime.now(),
        text: content,
      );
      _addMessage(message);
      return id;
    }

    // Codex mode
    if (state.isCodex) {
      final threadId = state.cxThreadId ?? '';
      final id = messageId ?? 'local-${DateTime.now().microsecondsSinceEpoch}';
      final message = ChatMessage(
        id: id,
        sessionId: threadId,
        role: MessageRole.user,
        createdAt: DateTime.now(),
        text: content,
      );
      _addMessage(message);
      return id;
    }

    // Pi mode
    if (state.isPi) {
      final sessionId = state.piSessionId ?? '';
      final id = messageId ?? 'local-${DateTime.now().microsecondsSinceEpoch}';
      final message = ChatMessage(
        id: id,
        sessionId: sessionId,
        role: MessageRole.user,
        createdAt: DateTime.now(),
        text: content,
      );
      _addMessage(message);
      return id;
    }

    // OpenCode mode
    final session = state.session;
    if (session == null) return '';

    final id = messageId ?? 'local-${DateTime.now().microsecondsSinceEpoch}';
    final message = ChatMessage(
      id: id,
      sessionId: session.id,
      role: MessageRole.user,
      createdAt: DateTime.now(),
      text: content,
    );
    _addMessage(message);
    if (messageId != null && messageId.isNotEmpty) {
      _localAuthoredUserMessageIds.add(messageId);
      // Also register text for reconciliation: OpenCode SDK generates its own
      // message ID (different from the client-generated one), so we need
      // text-based matching to detect & replace this optimistic message when
      // the server echo arrives with a different ID.
      final normalized = _normalizeUserText(content);
      if (normalized.isNotEmpty) {
        _pendingLocalUserTextByMessageId[id] = normalized;
      }
    } else {
      final normalized = _normalizeUserText(content);
      if (normalized.isNotEmpty) {
        _pendingLocalUserTextByMessageId[id] = normalized;
      }
    }
    return id;
  }

  void appendLocalAssistantMessage(String content) {
    final sessionId = state.isClaudeCode
        ? (state.ccSessionId ?? '')
        : state.isCodex
        ? (state.cxThreadId ?? '')
        : state.isPi
        ? (state.piSessionId ?? '')
        : (state.session?.id ?? '');
    if (sessionId.isEmpty) return;
    final message = ChatMessage(
      id: 'local-assistant-${DateTime.now().microsecondsSinceEpoch}',
      sessionId: sessionId,
      role: MessageRole.assistant,
      createdAt: DateTime.now(),
      text: content,
    );
    _addMessage(message);
  }

  void resolvePermission(String permissionId) {
    state = state.copyWith(
      permissions: state.permissions
          .where((item) => item.id != permissionId)
          .toList(),
    );
  }

  List<DiffEntry> _mergeToolDiffs(
    List<DiffEntry> existing, {
    required ToolCall tool,
  }) {
    final extracted = _extractDiffFromTool(tool);
    if (extracted == null) return existing;

    // Dedupe by (file, partId) to avoid repeated tool updates spamming diffs.
    return [
      for (final diff in existing)
        if (diff.file != extracted.file || diff.partId != extracted.partId)
          diff,
      extracted,
    ];
  }

  DiffEntry? _extractDiffFromTool(ToolCall tool) {
    final status = tool.status.toLowerCase();
    final isFinal =
        status == 'completed' ||
        status == 'success' ||
        status == 'error' ||
        status == 'failed';
    if (!isFinal) return null;

    final metadata = tool.metadata;
    if (metadata.isEmpty) return null;

    final diffText = metadata['diff'] as String?;
    final filediff = metadata['filediff'];

    String file = '';
    String before = '';
    String after = '';
    String? fileStatus;
    int additions = 0;
    int deletions = 0;

    if (filediff is Map<String, dynamic>) {
      file =
          filediff['file'] as String? ??
          filediff['path'] as String? ??
          filediff['after'] as String? ??
          filediff['before'] as String? ??
          '';
      before = filediff['before'] as String? ?? '';
      after = filediff['after'] as String? ?? '';
      fileStatus = filediff['status'] as String?;
      additions = (filediff['additions'] as num?)?.toInt() ?? 0;
      deletions = (filediff['deletions'] as num?)?.toInt() ?? 0;
    }

    file = file.isNotEmpty
        ? file
        : (tool.input['filePath'] as String? ??
              tool.input['path'] as String? ??
              tool.input['file'] as String? ??
              '');

    // If we only have a unified diff text, derive +/- counts from it.
    if ((additions == 0 && deletions == 0) && diffText != null) {
      final lines = diffText.split('\n');
      for (final line in lines) {
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('+')) additions++;
        if (line.startsWith('-')) deletions++;
      }
    }

    if (file.isEmpty) return null;
    if ((diffText == null || diffText.isEmpty) &&
        before.isEmpty &&
        after.isEmpty) {
      return null;
    }

    return DiffEntry(
      file: file,
      before: before,
      after: after,
      additions: additions,
      deletions: deletions,
      diff: diffText,
      partId: tool.partId,
      status: fileStatus,
    );
  }

  /// Update todos from fetched data (called by chat screen)
  void setTodos(List<Todo> todos) {
    state = state.copyWith(todos: todos);
  }

  /// Set compacting state (called when starting summarize)
  void setCompacting(bool isCompacting) {
    state = state.copyWith(isCompacting: isCompacting);
  }

  /// Update VCS info from fetched data
  void setVcsInfo(VcsInfo vcsInfo) {
    state = state.copyWith(vcsInfo: vcsInfo);
  }

  /// Update session status from fetched data
  void setSessionStatus(SessionStatus status) {
    state = state.copyWith(sessionStatus: status);
  }

  void _addMessage(ChatMessage message) {
    if (!_messages.containsKey(message.id)) {
      _order.add(message.id);
    }
    _messages[message.id] = message;
    if (_suppressEmit) {
      _pendingEmitMessages = true;
      return;
    }
    _emitMessages();
  }

  void _updateMessage(String id, ChatMessage message) {
    if (!_messages.containsKey(id)) {
      _order.add(id);
    }
    _messages[id] = message;
    if (_suppressEmit) {
      _pendingEmitMessages = true;
      return;
    }
    _emitMessages();
  }

  void _emitMessages() {
    final list = _order.map((id) => _messages[id]!).toList();
    // FIX: Calculate content length here once when messages change
    // instead of recalculating on every UI frame
    final contentLength = _calculateContentLength(list);
    state = state.copyWith(messages: list, contentLength: contentLength);
  }

  /// Calculate content length for auto-scroll detection
  /// This is now called once per emit instead of every frame
  int _calculateContentLength(List<ChatMessage> messages) {
    int length = 0;
    for (final msg in messages) {
      length += msg.text.length;
      length += msg.toolCalls.length * 100;
      length += msg.diffs.length * 100;
      length += msg.subtaskNotifications.length * 50;
      length += msg.reasoningParts.fold(0, (sum, r) => sum + r.text.length);
    }
    return length;
  }

  // ============================================================
  // Claude Code Helpers (used by runtime_cc_metadata_handler.dart)
  // ============================================================

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

  /// Clear the pending CC message queue (cancel or after auto-send).
  /// Uses full reconstruction because copyWith can't set nullable fields to null.
  void clearPendingCCMessage() {
    if (state.pendingCCMessage == null && state.pendingCCAttachments == null) {
      return;
    }
    state = ChatSessionState(
      session: state.session,
      projectPath: state.projectPath,
      messages: state.messages,
      permissions: state.permissions,
      sessionDiffs: state.sessionDiffs,
      todos: state.todos,
      vcsInfo: state.vcsInfo,
      isCompacting: state.isCompacting,
      sessionStatus: state.sessionStatus,
      isClaudeCode: state.isClaudeCode,
      ccSessionId: state.ccSessionId,
      ccCwd: state.ccCwd,
      ccModel: state.ccModel,
      ccInit: state.ccInit,
      ccTokenUsage: state.ccTokenUsage,
      ccStructuredOutput: state.ccStructuredOutput,
      ccIsStreaming: state.ccIsStreaming,
      isCodex: state.isCodex,
      cxThreadId: state.cxThreadId,
      cxCwd: state.cxCwd,
      cxModel: state.cxModel,
      cxTokenUsage: state.cxTokenUsage,
      cxIsStreaming: state.cxIsStreaming,
      cxCollabTree: state.cxCollabTree,
      cxPendingUserInput: state.cxPendingUserInput,
      pendingQuestion: state.pendingQuestion,
      contentLength: state.contentLength,
      ocAgentMode: state.ocAgentMode,
      mcpOAuthPending: state.mcpOAuthPending,
      // Explicitly cleared:
      pendingCCMessage: null,
      pendingCCAttachments: null,
      isPi: state.isPi,
      piSessionId: state.piSessionId,
      piCwd: state.piCwd,
      piModel: state.piModel,
      piModelData: state.piModelData,
      piThinkingLevel: state.piThinkingLevel,
      piIsStreaming: state.piIsStreaming,
    );
  }

  /// Mark all streaming messages as complete (for abort/unstick scenarios)
  void markAllStreamingComplete() {
    var changed = false;
    for (final id in _order) {
      final msg = _messages[id];
      if (msg == null) continue;
      if (!msg.isStreaming) continue;
      _messages[id] = msg.copyWith(isStreaming: false);
      changed = true;
    }
    // Also clear any streaming-related state flags
    state = state.copyWith(sessionStatus: const SessionStatus.idle());
    if (changed) {
      if (_suppressEmit) {
        _pendingEmitMessages = true;
      } else {
        _emitMessages();
      }
    }
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

  // ============================================================
  // Shared Helpers (used by runtime_cx_handlers.dart)
  // ============================================================

  (int, int) _countUnifiedDiffAddsDels(String diff) {
    var adds = 0;
    var dels = 0;
    for (final line in diff.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) adds++;
      if (line.startsWith('-')) dels++;
    }
    return (adds, dels);
  }

  /// Set Codex streaming state (called when sending a message)
  void setCodexStreaming(bool isStreaming) {
    state = state.copyWith(cxIsStreaming: isStreaming);
  }

  @override
  void dispose() {
    _rawSubscription?.cancel();
    _runtimeEventSubscription?.cancel();
    _runtimeStateSubscription?.cancel();
    _textDebounceTimer?.cancel();
    super.dispose();
  }
}

final chatSessionProvider =
    StateNotifierProvider<ChatSessionNotifier, ChatSessionState>((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      return ChatSessionNotifier(bridge);
    });
