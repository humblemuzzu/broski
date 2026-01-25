import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/message.dart';
import '../models/question.dart';
import '../models/session.dart';
import '../models/todo.dart';
import '../models/vcs.dart';
import '../services/bridge_service.dart';
import '../services/demo_data_service.dart';
import 'service_providers.dart';

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

  /// Get the effective session ID (works for both OC and CC)
  String? get effectiveSessionId => isClaudeCode
      ? ccSessionId
      : isCodex
      ? cxThreadId
      : session?.id;

  /// Get the effective project path (works for both OC and CC)
  String? get effectivePath => isClaudeCode
      ? ccCwd
      : isCodex
      ? cxCwd
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
    );
  }
}

class ChatSessionNotifier extends StateNotifier<ChatSessionState> {
  ChatSessionNotifier(this._bridge) : super(const ChatSessionState()) {
    _subscription = _bridge.sdkEvents.listen(_enqueueSdkEvent);
    _ccSubscription = _bridge.ccStreamMessages.listen(_handleCCStreamMessage);
    _cxSubscription = _bridge.codexStreamMessages.listen(
      _handleCodexStreamMessage,
    );
    _rawSubscription = _bridge.messages.listen(_handleRawBridgeMessage);
  }

  final BridgeService _bridge;
  final Map<String, ChatMessage> _messages = {};
  final List<String> _order = [];
  final Map<String, MessageRole> _rolesByMessageId = {};
  final Map<String, String> _pendingLocalUserTextByMessageId = {};
  final Set<String> _localAuthoredUserMessageIds = {};
  StreamSubscription<Map<String, dynamic>>? _subscription;
  StreamSubscription<ClaudeCodeStreamMessage>? _ccSubscription;
  StreamSubscription<CodexStreamMessage>? _cxSubscription;
  StreamSubscription<Map<String, dynamic>>? _rawSubscription;

  final Map<String, int> _lastCcFsNoticeAtMs = {};

  final List<Map<String, dynamic>> _pendingEvents = [];
  Timer? _flushTimer;
  bool _suppressEmit = false;
  bool _pendingEmitMessages = false;

  Timer? _textDebounceTimer;
  final Map<String, StringBuffer> _pendingTextBuffers = {};
  int _lastRttMs = 0;
  bool _lspStatusFetched = false;

  Future<void> replyToPendingQuestion(List<List<String>> answers) async {
    final req = state.pendingQuestion;
    if (req == null || req.id.isEmpty) return;
    await _bridge.ocReplyToQuestion(requestId: req.id, answers: answers);
    state = state.copyWith(pendingQuestion: null);
  }

  Future<void> rejectPendingQuestion() async {
    final req = state.pendingQuestion;
    if (req == null || req.id.isEmpty) return;
    await _bridge.ocRejectQuestion(requestId: req.id);
    state = state.copyWith(pendingQuestion: null);
  }

  /// Reply to a Codex request_user_input (SDK v0.87.0+)
  /// [answers] is indexed by question position, matching the UI's output format
  void replyToCodexUserInput(List<List<String>> answers) {
    final req = state.cxPendingUserInput;
    if (req == null || req.requestId.isEmpty) return;

    // Convert List<List<String>> to Map<questionId, {selected: [...], other?: ...}>
    final answersMap = <String, Map<String, dynamic>>{};
    for (var i = 0; i < req.questions.length && i < answers.length; i++) {
      final questionId = req.questions[i].id;
      final selected = answers[i].where((s) => s.trim().isNotEmpty).toList();
      answersMap[questionId] = {'selected': selected};
    }

    _bridge.cxRespondToUserInput(requestId: req.requestId, answers: answersMap);
    _clearCxPendingUserInput();
  }

  /// Dismiss/reject a Codex request_user_input (SDK v0.87.0+)
  void rejectCodexUserInput() {
    final req = state.cxPendingUserInput;
    if (req == null || req.requestId.isEmpty) return;

    // Send empty answers to dismiss
    final answersMap = <String, Map<String, dynamic>>{};
    for (final q in req.questions) {
      answersMap[q.id] = {'selected': <String>[]};
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
      if (!localId.startsWith('local-')) continue;
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

  // FIX: Track session switch to prevent race conditions
  // Events captured before session switch should be discarded
  int _sessionVersion = 0;
  int _eventCaptureVersion = 0;

  // Claude Code streaming state
  String _ccCurrentAssistantMessageId = '';
  final StringBuffer _ccAssistantTextBuffer = StringBuffer();
  final Map<String, ToolCall> _ccPendingToolCallsById = {};
  String _ccThinkingPartId = '';
  final StringBuffer _ccThinkingBuffer = StringBuffer();
  Timer? _ccUpdateTimer;

  // Claude Code ordered parts tracking (for text-tool-text interleaved rendering)
  final List<MessagePart> _ccOrderedParts = [];
  int _ccPartSequence = 0;
  // Track the current text part index (-1 if last part was not text)
  int _ccCurrentTextPartIndex = -1;

  // Codex streaming state (ordered parts)
  String _cxCurrentAssistantMessageId = '';
  final StringBuffer _cxAssistantTextBuffer = StringBuffer();
  final Map<String, ToolCall> _cxPendingToolCallsById = {};
  String _cxThinkingPartId = '';
  final StringBuffer _cxThinkingBuffer = StringBuffer();
  Timer? _cxUpdateTimer;
  final List<MessagePart> _cxOrderedParts = [];
  int _cxPartSequence = 0;
  int _cxCurrentTextPartIndex = -1;

  void _ensureCCHasRenderableTextPart({required bool isStreaming}) {
    final text = _ccAssistantTextBuffer.toString();
    if (text.trim().isEmpty) return;

    final hasTextPart = _ccOrderedParts.any(
      (p) => p is TextPart && p.text.trim().isNotEmpty,
    );
    if (hasTextPart) return;

    // Best-effort fallback: if tools streamed but no text deltas arrived,
    // synthesize a single text part so the ordered-parts UI can render output.
    _ccOrderedParts.insert(
      0,
      TextPart(
        sequence: _ccPartSequence++,
        text: text,
        isStreaming: isStreaming,
      ),
    );
    _ccCurrentTextPartIndex = 0;
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
    // FIX: Increment session version to invalidate pending events
    _sessionVersion++;
    _messages.clear();
    _order.clear();
    _rolesByMessageId.clear();
    _pendingLocalUserTextByMessageId.clear();
    _localAuthoredUserMessageIds.clear();
    _pendingEvents.clear(); // FIX: Clear pending events for old session
    _pendingTextBuffers.clear(); // FIX: Clear text buffers for old session
    _flushTimer?.cancel();
    _flushTimer = null;
    _textDebounceTimer?.cancel();
    _textDebounceTimer = null;
    _lspStatusFetched = false;
    _resetCCState();
    _resetCodexState();
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
    // FIX: Increment session version to invalidate pending events
    _sessionVersion++;
    _messages.clear();
    _order.clear();
    _rolesByMessageId.clear();
    _pendingLocalUserTextByMessageId.clear();
    _localAuthoredUserMessageIds.clear();
    _pendingEvents.clear(); // FIX: Clear pending events for old session
    _pendingTextBuffers.clear(); // FIX: Clear text buffers for old session
    _flushTimer?.cancel();
    _flushTimer = null;
    _textDebounceTimer?.cancel();
    _textDebounceTimer = null;
    _lspStatusFetched = false;
    _resetCCState();
    _resetCodexState();
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
    _sessionVersion++;
    _messages.clear();
    _order.clear();
    _rolesByMessageId.clear();
    _pendingLocalUserTextByMessageId.clear();
    _localAuthoredUserMessageIds.clear();
    _pendingEvents.clear();
    _pendingTextBuffers.clear();
    _flushTimer?.cancel();
    _flushTimer = null;
    _textDebounceTimer?.cancel();
    _textDebounceTimer = null;
    _lspStatusFetched = false;
    _resetCCState();
    _resetCodexState();
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

  void _resetCCState() {
    _ccCurrentAssistantMessageId = '';
    _ccAssistantTextBuffer.clear();
    _ccPendingToolCallsById.clear();
    _ccThinkingPartId = '';
    _ccThinkingBuffer.clear();
    _ccUpdateTimer?.cancel();
    _ccUpdateTimer = null;
    // Reset ordered parts tracking
    _ccOrderedParts.clear();
    _ccPartSequence = 0;
    _ccCurrentTextPartIndex = -1;
  }

  void _resetCodexState() {
    _cxCurrentAssistantMessageId = '';
    _cxAssistantTextBuffer.clear();
    _cxPendingToolCallsById.clear();
    _cxThinkingPartId = '';
    _cxThinkingBuffer.clear();
    _cxUpdateTimer?.cancel();
    _cxUpdateTimer = null;
    _cxOrderedParts.clear();
    _cxPartSequence = 0;
    _cxCurrentTextPartIndex = -1;
  }

  void _scheduleCCAssistantUpdate({required bool isStreaming}) {
    if (_ccUpdateTimer != null) return;
    _ccUpdateTimer = Timer(const Duration(milliseconds: 16), () {
      _ccUpdateTimer = null;
      _updateCCAssistantMessage(isStreaming: isStreaming);
    });
  }

  void _flushCCAssistantUpdate({required bool isStreaming}) {
    _ccUpdateTimer?.cancel();
    _ccUpdateTimer = null;
    _updateCCAssistantMessage(isStreaming: isStreaming);
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
    _resetCodexState();

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

  /// Hydrate chat with demo messages for App Store review mode.
  /// Uses pre-built sample conversations from DemoDataService.
  void hydrateDemoMessages(String sessionId) {
    _messages.clear();
    _order.clear();
    state = state.copyWith(
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
    );

    final demoMessages = DemoDataService.instance.getDemoMessages(sessionId);
    for (final message in demoMessages) {
      _addMessage(message);
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

  void _enqueueSdkEvent(Map<String, dynamic> event) {
    // FIX: Capture current session version when event arrives
    _eventCaptureVersion = _sessionVersion;
    _pendingEvents.add(event);
    _flushTimer ??= Timer(const Duration(milliseconds: 16), _flushSdkEvents);
  }

  void _flushSdkEvents() {
    _flushTimer = null;
    if (_pendingEvents.isEmpty) return;

    // FIX: Check if session changed since events were captured
    // If so, discard all pending events - they're for the old session
    if (_eventCaptureVersion != _sessionVersion) {
      _pendingEvents.clear();
      return;
    }

    final batch = List<Map<String, dynamic>>.from(_pendingEvents);
    _pendingEvents.clear();

    _suppressEmit = true;
    _pendingEmitMessages = false;
    for (final event in batch) {
      _handleSdkEvent(event);
    }
    _suppressEmit = false;
    if (_pendingEmitMessages) {
      _emitMessages();
    }
  }

  void _handleSdkEvent(Map<String, dynamic> event) {
    final payload = event['payload'] as Map<String, dynamic>? ?? const {};
    final type = payload['type'] as String?;
    if (type == null) return;

    String extractSessionIdFromSdkPayload(Map<String, dynamic> payload) {
      final properties =
          payload['properties'] as Map<String, dynamic>? ?? const {};
      final info = properties['info'] as Map<String, dynamic>?;
      final part = properties['part'] as Map<String, dynamic>?;
      return (info?['sessionID'] as String?) ??
          (info?['sessionId'] as String?) ??
          (properties['sessionID'] as String?) ??
          (properties['sessionId'] as String?) ??
          (part?['sessionID'] as String?) ??
          (part?['sessionId'] as String?) ??
          '';
    }

    // Filter by directory/project path, but let sessionId matching win.
    // This prevents missing live updates when directory identifiers differ across clients.
    final currentOpenCodeSessionId = state.session?.id ?? '';
    final sid = extractSessionIdFromSdkPayload(payload);
    final shouldBypassDirectoryFilter =
        currentOpenCodeSessionId.isNotEmpty &&
        sid.isNotEmpty &&
        sid == currentOpenCodeSessionId;

    if (!shouldBypassDirectoryFilter) {
      final eventDirectory = event['directory'] as String?;
      if (eventDirectory != null && state.projectPath != null) {
        final normalizedEventDir = eventDirectory.replaceAll(
          RegExp(r'/+$'),
          '',
        );
        final normalizedStateDir = state.projectPath!.replaceAll(
          RegExp(r'/+$'),
          '',
        );
        if (normalizedEventDir != normalizedStateDir) {
          return;
        }
      }
    }

    switch (type) {
      case 'message.updated':
        _handleMessageUpdated(payload);
        break;
      case 'message.part.updated':
        _handleMessagePartUpdated(payload);
        break;
      case 'permission.updated':
      case 'permission.asked':
        _handlePermissionUpdated(payload);
        break;
      case 'permission.replied':
        _handlePermissionReplied(payload);
        break;
      case 'question.asked':
        _handleQuestionAsked(payload);
        break;
      case 'question.replied':
        _handleQuestionReplied(payload);
        break;
      case 'question.rejected':
        _handleQuestionRejected(payload);
        break;
      case 'session.diff':
        _handleSessionDiff(payload);
        break;
      case 'session.error':
        _handleSessionError(payload);
        break;
      // Feature 1: Todo/Plan Management
      case 'todo.updated':
        _handleTodoUpdated(payload);
        break;
      // Feature 9: Session Compacted
      case 'session.compacted':
        _handleSessionCompacted(payload);
        break;
      // Feature 10: VCS Branch Updated
      case 'vcs.branch.updated':
        _handleVcsBranchUpdated(payload);
        break;
      // Feature 13: Session Status
      case 'session.status':
        _handleSessionStatus(payload);
        break;
      case 'session.idle':
        _handleSessionIdle(payload);
        break;
      // OpenCode SDK v1.1.23+: MCP OAuth browser open failed (remote/headless sessions)
      case 'mcp.browser.open.failed':
        _handleMcpBrowserOpenFailed(payload);
        break;
      default:
        if (kDebugMode) {
          developer.log('Unhandled event type: $type', name: 'ChatProvider');
        }
        break;
    }
  }

  /// Handle MCP OAuth browser open failure (SDK v1.1.23+).
  /// When running OpenCode on a headless server, the browser can't open for OAuth.
  /// This allows the mobile app to display the URL for manual opening.
  void _handleMcpBrowserOpenFailed(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final mcpName =
        properties['mcpName'] as String? ??
        properties['server'] as String? ??
        'MCP Server';
    final url = properties['url'] as String?;

    if (kDebugMode) {
      developer.log(
        'MCP OAuth browser open failed for $mcpName${url != null ? ': $url' : ''}',
        name: 'ChatProvider',
      );
    }

    // Store the URL so UI can display it for manual opening
    if (url != null && url.isNotEmpty) {
      state = state.copyWith(
        mcpOAuthPending: McpOAuthPending(serverName: mcpName, url: url),
      );
    }
  }

  void _handleMessageUpdated(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final info = properties['info'] as Map<String, dynamic>?;
    if (info == null) return;
    final sessionId =
        info['sessionID'] as String? ?? info['sessionId'] as String? ?? '';
    if (state.session?.id != sessionId) return;

    final messageId = info['id'] as String? ?? '';
    if (messageId.isEmpty) return;
    final roleRaw = info['role'] as String? ?? 'assistant';
    final role = roleRaw == 'user'
        ? MessageRole.user
        : roleRaw == 'system'
        ? MessageRole.system
        : MessageRole.assistant;
    final created =
        info['time']?['created'] as int? ??
        DateTime.now().millisecondsSinceEpoch;

    _rolesByMessageId[messageId] = role;

    final existing = _messages[messageId];
    if (existing == null) {
      _addMessage(
        ChatMessage(
          id: messageId,
          sessionId: sessionId,
          role: role,
          createdAt: DateTime.fromMillisecondsSinceEpoch(created),
          text: '',
        ),
      );
      return;
    }

    if (existing.role != role) {
      final updated = _copyWithRole(existing, role);
      _updateMessage(messageId, updated);

      // If parts arrived before message.updated, we may already have the user text.
      // Use it to reconcile optimistic local user messages.
      if (role == MessageRole.user && !messageId.startsWith('local-')) {
        final localId = _findPendingLocalUserMessageId(
          sessionId: sessionId,
          candidateText: updated.text,
        );
        if (localId != null) {
          _reconcileLocalUserMessage(
            localMessageId: localId,
            serverMessageId: messageId,
            sessionId: sessionId,
          );
        }
      }
      return;
    }

    if (role == MessageRole.user &&
        !messageId.startsWith('local-') &&
        existing.text.isNotEmpty) {
      final localId = _findPendingLocalUserMessageId(
        sessionId: sessionId,
        candidateText: existing.text,
      );
      if (localId != null) {
        _reconcileLocalUserMessage(
          localMessageId: localId,
          serverMessageId: messageId,
          sessionId: sessionId,
        );
      }
    }
  }

  void _handleMessagePartUpdated(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final part = properties['part'] as Map<String, dynamic>? ?? const {};
    final sessionId =
        part['sessionID'] as String? ?? part['sessionId'] as String? ?? '';
    if (state.session?.id != sessionId) return;

    final messageId =
        part['messageID'] as String? ??
        part['messageId'] as String? ??
        part['message_id'] as String? ??
        '';
    if (messageId.isEmpty) return;

    var message = _messages[messageId];
    final knownRole = _rolesByMessageId[messageId];
    final resolvedRole = knownRole ?? message?.role ?? MessageRole.assistant;
    if (message == null) {
      message = ChatMessage(
        id: messageId,
        sessionId: sessionId,
        role: resolvedRole,
        createdAt: DateTime.now(),
        text: '',
      );
    } else if (message.role != resolvedRole) {
      message = _copyWithRole(message, resolvedRole);
      _messages[messageId] = message;
    }

    final partType = part['type'] as String? ?? '';

    if (partType == 'text') {
      final isSynthetic = part['synthetic'] as bool? ?? false;
      final isIgnored = part['ignored'] as bool? ?? false;
      if (isSynthetic || isIgnored) {
        return;
      }

      // If this device authored the user message with a stable message ID, keep
      // the locally-rendered text (may include UI-only decorations like
      // attachment labels) and avoid overwriting it with server echoes.
      final current = _messages[messageId] ?? message;
      if (resolvedRole == MessageRole.user &&
          _localAuthoredUserMessageIds.contains(messageId) &&
          current.text.isNotEmpty) {
        return;
      }

      final delta = properties['delta'] as String?;
      final text = part['text'] as String? ?? '';
      final partTime = part['time'] as Map<String, dynamic>?;
      final isComplete = (partTime?['end'] as int?) != null;
      final shouldShowStreaming =
          resolvedRole == MessageRole.assistant && !isComplete;

      if (resolvedRole == MessageRole.user) {
        final candidate = text.isNotEmpty ? text : (delta ?? '');
        final localId = _findPendingLocalUserMessageId(
          sessionId: sessionId,
          candidateText: candidate,
        );
        if (localId != null) {
          _reconcileLocalUserMessage(
            localMessageId: localId,
            serverMessageId: messageId,
            sessionId: sessionId,
          );
        }
      }

      // Re-read after potential reconciliation.
      final currentAfter = _messages[messageId] ?? message;

      // If we have a full snapshot, prefer it (helps late-joiners catch up).
      if (delta != null && currentAfter.text.isEmpty && text.isNotEmpty) {
        _updateMessage(
          messageId,
          currentAfter.copyWith(text: text, isStreaming: shouldShowStreaming),
        );
        return;
      }

      if (resolvedRole == MessageRole.assistant &&
          delta != null &&
          _lastRttMs > 50) {
        _pendingTextBuffers.putIfAbsent(messageId, () => StringBuffer());
        _pendingTextBuffers[messageId]!.write(delta);

        _textDebounceTimer?.cancel();
        _textDebounceTimer = Timer(
          Duration(milliseconds: _lastRttMs.clamp(30, 100).toInt()),
          () => _flushPendingText(messageId, currentAfter),
        );
      } else {
        final updated = delta != null ? currentAfter.text + delta : text;
        _updateMessage(
          messageId,
          currentAfter.copyWith(
            text: updated,
            isStreaming: delta != null ? true : shouldShowStreaming,
          ),
        );
      }
      return;
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
      final status = stateInfo['status'] as String? ?? 'pending';
      final title = stateInfo['title'] as String?;
      final input = stateInfo['input'] as Map<String, dynamic>? ?? const {};
      final output = stateInfo['output'] as String?;
      final metadataRaw = stateInfo['metadata'];
      final metadata = metadataRaw is Map<String, dynamic>
          ? metadataRaw
          : const <String, dynamic>{};

      final existing = message.toolCalls
          .where((tool) => tool.callId == callId)
          .toList();
      final updatedTool =
          (existing.isNotEmpty ? existing.first : null)?.copyWith(
            status: status,
            title: title,
            input: input,
            output: output,
            metadata: metadata,
          ) ??
          ToolCall(
            callId: callId,
            partId: partId.isNotEmpty ? partId : callId,
            name: toolName,
            status: status,
            title: title,
            input: input,
            output: output,
            metadata: metadata,
          );

      final updatedTools = [
        for (final tool in message.toolCalls)
          if (tool.callId != callId) tool,
        updatedTool,
      ];

      final updatedDiffs = _mergeToolDiffs(message.diffs, tool: updatedTool);

      _updateMessage(
        messageId,
        message.copyWith(toolCalls: updatedTools, diffs: updatedDiffs),
      );

      // Trigger LSP status fetch once after first 'read' tool completes
      if (!_lspStatusFetched && toolName == 'Read' && status == 'completed') {
        _lspStatusFetched = true;
        _fetchLspStatus();
      }

      // OpenCode Plan Mode: Detect plan_enter/plan_exit tool completion
      // When these tools complete, update the agent mode state
      if (status == 'completed') {
        if (toolName == 'plan_enter') {
          state = state.copyWith(ocAgentMode: 'plan');
        } else if (toolName == 'plan_exit') {
          state = state.copyWith(ocAgentMode: 'build');
        }
      }
    }

    // Handle subtask parts (background task notifications)
    if (partType == 'subtask') {
      final subtask = SubtaskNotification.fromJson(part);
      final existing = message.subtaskNotifications
          .where((s) => s.id == subtask.id)
          .toList();

      if (existing.isEmpty) {
        final updatedSubtasks = [...message.subtaskNotifications, subtask];

        _updateMessage(
          messageId,
          message.copyWith(subtaskNotifications: updatedSubtasks),
        );
      }
    }

    // Handle reasoning parts (model thinking/reasoning content)
    if (partType == 'reasoning') {
      final partId = part['id'] as String? ?? '';
      final delta = properties['delta'] as String?;
      final text = part['text'] as String? ?? '';
      final time = part['time'] as Map<String, dynamic>?;
      final startTime = time?['start'] as int?;
      final endTime = time?['end'] as int?;

      // Find existing reasoning part with same ID
      final existingIdx = message.reasoningParts.indexWhere(
        (r) => r.id == partId,
      );

      if (existingIdx >= 0) {
        // Update existing reasoning part (streaming delta or completion)
        final existing = message.reasoningParts[existingIdx];
        final updatedText = delta != null ? existing.text + delta : text;
        final isComplete = endTime != null;

        final updatedPart = existing.copyWith(
          text: updatedText,
          endTime: endTime,
          isStreaming: !isComplete,
        );

        final updatedParts = [...message.reasoningParts];
        updatedParts[existingIdx] = updatedPart;

        _updateMessage(
          messageId,
          message.copyWith(reasoningParts: updatedParts),
        );
      } else {
        // New reasoning part
        final isComplete = endTime != null;
        final newPart = ReasoningPart(
          id: partId,
          messageId: messageId,
          text: delta ?? text,
          startTime: startTime,
          endTime: endTime,
          isStreaming: !isComplete,
        );

        _updateMessage(
          messageId,
          message.copyWith(
            reasoningParts: [...message.reasoningParts, newPart],
          ),
        );
      }
    }
  }

  void _handlePermissionUpdated(Map<String, dynamic> payload) {
    final permission =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final sessionId =
        permission['sessionID'] as String? ??
        permission['sessionId'] as String? ??
        '';
    if (state.session?.id != sessionId) return;

    // Parse tool reference if present (SDK v1.1.1+)
    final toolData = permission['tool'] as Map<String, dynamic>?;
    final tool = toolData != null ? ToolReference.fromJson(toolData) : null;

    // Parse patterns arrays (SDK v1.1.1+)
    final patterns =
        (permission['patterns'] as List<dynamic>?)
            ?.map((e) => e as String)
            .toList() ??
        const [];
    final always =
        (permission['always'] as List<dynamic>?)
            ?.map((e) => e as String)
            .toList() ??
        const [];

    final request = PermissionRequest(
      id: permission['id'] as String? ?? '',
      sessionId: sessionId,
      title: permission['title'] as String? ?? 'Permission required',
      permission: permission['permission'] as String?,
      patterns: patterns,
      always: always,
      tool: tool,
      command: permission['metadata']?['command'] as String?,
      metadata: permission['metadata'] as Map<String, dynamic>? ?? const {},
    );

    state = state.copyWith(permissions: [...state.permissions, request]);
  }

  void _handlePermissionReplied(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final requestId =
        properties['permissionID'] as String? ??
        properties['requestID'] as String? ??
        properties['requestId'] as String? ??
        '';
    if (requestId.isEmpty) return;

    state = state.copyWith(
      permissions: state.permissions
          .where((item) => item.id != requestId)
          .toList(),
    );
  }

  void _handleQuestionAsked(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final sessionId =
        (properties['sessionID'] as String?) ??
        (properties['sessionId'] as String?) ??
        '';
    if (sessionId.isEmpty || state.session?.id != sessionId) return;
    final request = QuestionRequest.fromJson(properties);
    if (request.id.isEmpty) return;
    state = state.copyWith(pendingQuestion: request);
  }

  void _handleQuestionReplied(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final requestId =
        (properties['requestID'] as String?) ??
        (properties['requestId'] as String?) ??
        '';
    if (requestId.isEmpty) return;
    final pending = state.pendingQuestion;
    if (pending != null && pending.id == requestId) {
      state = state.copyWith(pendingQuestion: null);
    }
  }

  void _handleQuestionRejected(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final requestId =
        (properties['requestID'] as String?) ??
        (properties['requestId'] as String?) ??
        '';
    if (requestId.isEmpty) return;
    final pending = state.pendingQuestion;
    if (pending != null && pending.id == requestId) {
      state = state.copyWith(pendingQuestion: null);
    }
  }

  void _handleSessionDiff(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final sessionId =
        properties['sessionID'] as String? ??
        properties['sessionId'] as String? ??
        '';
    if (state.session?.id != sessionId) return;

    final diffs = (properties['diff'] as List<dynamic>? ?? [])
        .map(
          (item) => DiffEntry(
            file: item['file'] as String? ?? '',
            before: item['before'] as String? ?? '',
            after: item['after'] as String? ?? '',
            additions: item['additions'] as int? ?? 0,
            deletions: item['deletions'] as int? ?? 0,
          ),
        )
        .toList();

    if (diffs.isEmpty) return;
    state = state.copyWith(sessionDiffs: diffs);
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
    int additions = 0;
    int deletions = 0;

    if (filediff is Map<String, dynamic>) {
      file = filediff['file'] as String? ?? '';
      before = filediff['before'] as String? ?? '';
      after = filediff['after'] as String? ?? '';
      additions = (filediff['additions'] as num?)?.toInt() ?? 0;
      deletions = (filediff['deletions'] as num?)?.toInt() ?? 0;
    }

    file = file.isNotEmpty
        ? file
        : (tool.input['filePath'] as String? ??
              tool.input['path'] as String? ??
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
    );
  }

  void _handleSessionError(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final sessionId =
        properties['sessionID'] as String? ??
        properties['sessionId'] as String? ??
        '';
    if (state.session?.id != sessionId) return;

    final error = properties['error'] as Map<String, dynamic>? ?? const {};
    final errorName = error['name'] as String? ?? 'Error';
    final errorData = error['data'] as Map<String, dynamic>? ?? const {};
    final errorMessage = errorData['message'] as String? ?? 'Unknown error';

    if (kDebugMode) {
      developer.log(
        'Session error: $errorName - $errorMessage',
        name: 'ChatProvider',
      );
    }

    // Add error as a system message so user sees it
    final messageId = 'error-${DateTime.now().millisecondsSinceEpoch}';
    final message = ChatMessage(
      id: messageId,
      sessionId: sessionId,
      role: MessageRole.system,
      createdAt: DateTime.now(),
      text: errorMessage,
      error: errorName,
    );
    _addMessage(message);
  }

  // Feature 1: Todo/Plan Management
  void _handleTodoUpdated(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final sessionId =
        properties['sessionID'] as String? ??
        properties['sessionId'] as String? ??
        '';
    if (state.session?.id != sessionId) return;

    final todosJson = properties['todos'] as List<dynamic>? ?? [];
    final todos = todosJson
        .map((item) => Todo.fromJson(item as Map<String, dynamic>))
        .toList();

    developer.log('Todos updated: ${todos.length} items', name: 'ChatProvider');
    state = state.copyWith(todos: todos);
  }

  /// Update todos from fetched data (called by chat screen)
  void setTodos(List<Todo> todos) {
    state = state.copyWith(todos: todos);
  }

  // Feature 9: Session Compacted
  void _handleSessionCompacted(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final sessionId =
        properties['sessionID'] as String? ??
        properties['sessionId'] as String? ??
        '';
    if (state.session?.id != sessionId) return;

    developer.log('Session compacted: $sessionId', name: 'ChatProvider');
    state = state.copyWith(isCompacting: false);
  }

  /// Set compacting state (called when starting summarize)
  void setCompacting(bool isCompacting) {
    state = state.copyWith(isCompacting: isCompacting);
  }

  // Feature 10: VCS Branch Updated
  void _handleVcsBranchUpdated(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final branch = properties['branch'] as String?;

    developer.log('VCS branch updated: $branch', name: 'ChatProvider');
    state = state.copyWith(vcsInfo: VcsInfo(branch: branch));
  }

  /// Update VCS info from fetched data
  void setVcsInfo(VcsInfo vcsInfo) {
    state = state.copyWith(vcsInfo: vcsInfo);
  }

  // Feature 13: Session Status
  void _handleSessionStatus(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final sessionId =
        properties['sessionID'] as String? ??
        properties['sessionId'] as String? ??
        '';
    if (state.session?.id != sessionId) return;

    final statusData =
        properties['status'] as Map<String, dynamic>? ?? const {};
    final status = SessionStatus.fromJson(statusData);

    developer.log(
      'Session status updated: ${status.displayString}',
      name: 'ChatProvider',
    );
    state = state.copyWith(sessionStatus: status);

    // When status becomes idle, mark streaming messages as complete
    // This ensures the UI shows the final rendered markdown instead of "generating"
    if (status.isIdle) {
      var changed = false;
      for (final id in _order) {
        final msg = _messages[id];
        if (msg == null) continue;
        if (!msg.isStreaming) continue;
        _messages[id] = msg.copyWith(isStreaming: false);
        changed = true;
      }
      if (changed) {
        if (_suppressEmit) {
          _pendingEmitMessages = true;
        } else {
          _emitMessages();
        }
      }
    }
  }

  void _handleSessionIdle(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final sessionId =
        properties['sessionID'] as String? ??
        properties['sessionId'] as String? ??
        '';
    if (state.session?.id != sessionId) return;

    state = state.copyWith(sessionStatus: const SessionStatus.idle());

    // Mark any streaming assistant messages as complete.
    var changed = false;
    for (final id in _order) {
      final msg = _messages[id];
      if (msg == null) continue;
      if (!msg.isStreaming) continue;
      _messages[id] = msg.copyWith(isStreaming: false);
      changed = true;
    }
    if (changed) {
      if (_suppressEmit) {
        _pendingEmitMessages = true;
      } else {
        _emitMessages();
      }
    }
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

  Future<void> _fetchLspStatus() async {
    final projectPath = state.projectPath;
    try {
      await _bridge.getLspStatus(projectPath: projectPath);
      developer.log(
        'LSP status fetched for $projectPath',
        name: 'ChatProvider',
      );
    } catch (e) {
      developer.log('Failed to fetch LSP status: $e', name: 'ChatProvider');
    }
  }

  void resetLspStatusFetched() {
    _lspStatusFetched = false;
  }

  // ============================================================
  // Claude Code Stream Message Handling
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

  void _handleCCStreamMessage(ClaudeCodeStreamMessage message) {
    // Only process if in Claude Code mode
    if (!state.isClaudeCode) return;

    void ensureTurnId(String? messageId) {
      final id = messageId ?? '';
      if (id.isEmpty) return;
      if (_ccCurrentAssistantMessageId == id) return;
      _resetCCState();
      _ccCurrentAssistantMessageId = id;
    }

    if (message is CCSessionCreated) {
      // Session started - update model if provided
      final prevSessionId = state.ccSessionId ?? '';
      state = state.copyWith(
        ccSessionId: message.sessionId.isNotEmpty
            ? message.sessionId
            : state.ccSessionId,
        ccModel: message.model ?? state.ccModel,
        ccIsStreaming: true,
      );
      final nextSessionId = message.sessionId.isNotEmpty
          ? message.sessionId
          : prevSessionId;
      if (nextSessionId.isNotEmpty && nextSessionId != prevSessionId) {
        _bridge.setView(sessionId: nextSessionId, agent: 'claude-code');
      }
      return;
    }

    if (message is CCSessionInit) {
      final prevSessionId = state.ccSessionId ?? '';
      state = state.copyWith(
        ccSessionId: message.sessionId.isNotEmpty
            ? message.sessionId
            : state.ccSessionId,
        ccModel: message.model.isNotEmpty ? message.model : state.ccModel,
        ccInit: message,
        ccIsStreaming: true,
      );
      final nextSessionId = message.sessionId.isNotEmpty
          ? message.sessionId
          : prevSessionId;
      if (nextSessionId.isNotEmpty && nextSessionId != prevSessionId) {
        _bridge.setView(sessionId: nextSessionId, agent: 'claude-code');
      }
      return;
    }

    if (message is CCPermissionRequest) {
      // Surface as the existing permission prompt UI (haptics + bottom sheet)
      final request = PermissionRequest(
        id: message.toolUseId,
        sessionId: message.sessionId,
        title: 'Allow ${message.tool}?',
        command: null,
        metadata: {
          'tool': message.tool,
          'input': message.input,
          if (message.decisionReason != null) 'reason': message.decisionReason,
          if (message.blockedPath != null) 'blockedPath': message.blockedPath,
          'hasSuggestions': message.hasSuggestions,
        },
      );
      state = state.copyWith(permissions: [request, ...state.permissions]);
      return;
    }

    if (message is CCAssistantMessageDelta) {
      ensureTurnId(message.messageId);
      // Streaming delta - accumulate text AND track in ordered parts
      _ccAssistantTextBuffer.write(message.content);

      // Track in ordered parts: append to current text part or create new one
      if (_ccCurrentTextPartIndex >= 0 &&
          _ccCurrentTextPartIndex < _ccOrderedParts.length) {
        // Append to existing text part
        final existingPart =
            _ccOrderedParts[_ccCurrentTextPartIndex] as TextPart;
        _ccOrderedParts[_ccCurrentTextPartIndex] = existingPart.copyWith(
          text: existingPart.text + message.content,
          isStreaming: true,
        );
      } else {
        // Create new text part (first text or after a tool)
        _ccCurrentTextPartIndex = _ccOrderedParts.length;
        _ccOrderedParts.add(
          TextPart(
            sequence: _ccPartSequence++,
            text: message.content,
            isStreaming: true,
          ),
        );
      }

      _scheduleCCAssistantUpdate(isStreaming: true);
      return;
    }

    if (message is CCAssistantMessage) {
      ensureTurnId(message.messageId);
      // Complete assistant message (if server sends full message)
      _ccAssistantTextBuffer.clear();
      _ccAssistantTextBuffer.write(message.content);
      _ensureCCHasRenderableTextPart(isStreaming: false);
      _flushCCAssistantUpdate(isStreaming: false);
      return;
    }

    if (message is CCThinkingDelta) {
      ensureTurnId(message.messageId);
      if (_ccThinkingPartId.isEmpty) {
        _ccThinkingPartId =
            message.partId ??
            'cc-thinking-${DateTime.now().microsecondsSinceEpoch}';
      }
      _ccThinkingBuffer.write(message.content);
      _scheduleCCAssistantUpdate(isStreaming: true);
      return;
    }

    if (message is CCToolCall) {
      ensureTurnId(message.messageId);
      // Check for TodoWrite tool - update todos state
      if (message.tool == 'TodoWrite') {
        _handleCCTodoWrite(message.input);
        // Don't show TodoWrite as a tool card in chat
        return;
      }

      // Tool call - add to current message
      final toolUseId =
          message.toolUseId ?? 'cc-${DateTime.now().microsecondsSinceEpoch}';
      final tool = ToolCall(
        callId: toolUseId,
        partId: toolUseId,
        name: message.tool,
        status: message.status,
        title: message.tool,
        input: message.input is Map<String, dynamic>
            ? message.input as Map<String, dynamic>
            : {'input': message.input?.toString() ?? ''},
        output: null,
        metadata: const {},
      );

      _ccPendingToolCallsById[tool.callId] = tool;

      // Track in ordered parts: add tool part and reset text tracking
      // Mark current text part as not streaming (tool arrived)
      if (_ccCurrentTextPartIndex >= 0 &&
          _ccCurrentTextPartIndex < _ccOrderedParts.length) {
        final existingPart =
            _ccOrderedParts[_ccCurrentTextPartIndex] as TextPart;
        _ccOrderedParts[_ccCurrentTextPartIndex] = existingPart.copyWith(
          isStreaming: false,
        );
      }
      // Add tool part
      _ccOrderedParts.add(
        ToolPart(sequence: _ccPartSequence++, callId: toolUseId),
      );
      // Reset text part index so next text creates a new part
      _ccCurrentTextPartIndex = -1;

      _scheduleCCAssistantUpdate(isStreaming: true);
      return;
    }

    if (message is CCToolResult) {
      ensureTurnId(message.messageId);
      // Tool completed - update tool status
      final toolUseId = message.toolUseId;
      if (toolUseId == null || toolUseId.isEmpty) return;
      final existing = _ccPendingToolCallsById[toolUseId];
      if (existing != null) {
        final toolMeta = _ccMetadataFromToolUseResult(message.toolUseResult);
        _ccPendingToolCallsById[toolUseId] = existing.copyWith(
          status: 'completed',
          output: message.result?.toString(),
          metadata: {...existing.metadata, ...toolMeta},
        );
        _scheduleCCAssistantUpdate(isStreaming: true);
      }
      return;
    }

    if (message is CCTokenUsage) {
      ensureTurnId(message.messageId);
      // End of turn - finalize assistant message
      state = state.copyWith(ccTokenUsage: message, ccIsStreaming: false);
      _ensureCCHasRenderableTextPart(isStreaming: false);
      _flushCCAssistantUpdate(isStreaming: false);
      // Reset for next turn
      _ccCurrentAssistantMessageId = '';
      _ccAssistantTextBuffer.clear();
      _ccPendingToolCallsById.clear();
      _ccThinkingPartId = '';
      _ccThinkingBuffer.clear();
      // Reset ordered parts tracking
      _ccOrderedParts.clear();
      _ccPartSequence = 0;
      _ccCurrentTextPartIndex = -1;
      return;
    }

    if (message is CCError) {
      // Error - add as system message
      state = state.copyWith(ccIsStreaming: false);
      final errorMsg = ChatMessage(
        id: 'cc-error-${DateTime.now().microsecondsSinceEpoch}',
        sessionId: state.ccSessionId ?? '',
        role: MessageRole.system,
        createdAt: DateTime.now(),
        text: message.message,
        error: message.code,
      );
      _addMessage(errorMsg);
      return;
    }
  }

  /// Update or create the current CC assistant message
  void _updateCCAssistantMessage({required bool isStreaming}) {
    if (_ccCurrentAssistantMessageId.isEmpty) {
      _ccCurrentAssistantMessageId =
          'cc-assistant-${DateTime.now().microsecondsSinceEpoch}';
    }

    final text = _ccAssistantTextBuffer.toString();
    final reasoningParts = <ReasoningPart>[];
    if (_ccThinkingBuffer.isNotEmpty) {
      reasoningParts.add(
        ReasoningPart(
          id: _ccThinkingPartId.isNotEmpty
              ? _ccThinkingPartId
              : 'cc-thinking-${DateTime.now().microsecondsSinceEpoch}',
          messageId: _ccCurrentAssistantMessageId,
          text: _ccThinkingBuffer.toString(),
          isStreaming: isStreaming,
        ),
      );
    }

    var diffs = <DiffEntry>[];
    for (final tool in _ccPendingToolCallsById.values) {
      diffs = _mergeToolDiffs(diffs, tool: tool);
    }

    // Build ordered parts list for sequential rendering
    // Mark the last text part's streaming state
    final orderedParts = <MessagePart>[];
    for (int i = 0; i < _ccOrderedParts.length; i++) {
      final part = _ccOrderedParts[i];
      if (part is TextPart) {
        // Last text part inherits the message's streaming state
        final isLastTextPart = i == _ccCurrentTextPartIndex;
        orderedParts.add(
          part.copyWith(isStreaming: isLastTextPart && isStreaming),
        );
      } else {
        orderedParts.add(part);
      }
    }

    final message = ChatMessage(
      id: _ccCurrentAssistantMessageId,
      sessionId: state.ccSessionId ?? '',
      role: MessageRole.assistant,
      createdAt: DateTime.now(),
      text: text,
      toolCalls: List<ToolCall>.unmodifiable(_ccPendingToolCallsById.values),
      diffs: diffs,
      reasoningParts: reasoningParts,
      parts: List<MessagePart>.unmodifiable(orderedParts),
      isStreaming: isStreaming,
    );

    _updateMessage(_ccCurrentAssistantMessageId, message);
  }

  /// Set CC streaming state (called when sending a message)
  void setCCStreaming(bool isStreaming) {
    state = state.copyWith(ccIsStreaming: isStreaming);
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
  // Codex Stream Message Handling
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

  void _handleCodexStreamMessage(CodexStreamMessage message) {
    if (!state.isCodex) return;

    if (message is CodexErrorMessage) {
      state = state.copyWith(cxIsStreaming: false);
      final errorMsg = ChatMessage(
        id: 'cx-error-${DateTime.now().microsecondsSinceEpoch}',
        sessionId: state.cxThreadId ?? '',
        role: MessageRole.system,
        createdAt: DateTime.now(),
        text: message.message,
        error: message.code,
      );
      _addMessage(errorMsg);
      return;
    }

    if (message is CodexRequestMessage) {
      final params = message.params;
      final threadId = (params['threadId'] ?? params['thread_id'])?.toString();
      if (threadId != null &&
          threadId.isNotEmpty &&
          state.cxThreadId != null &&
          state.cxThreadId != threadId) {
        return;
      }

      // Handle request_user_input (Codex SDK v0.87.0+)
      if (message.method == 'item/tool/requestUserInput') {
        final request = CodexUserInputRequest.fromJson(
          message.requestId,
          threadId ?? state.cxThreadId ?? '',
          params,
        );
        state = state.copyWith(cxPendingUserInput: request);
        return;
      }

      if (message.method == 'item/commandExecution/requestApproval' ||
          message.method == 'item/fileChange/requestApproval') {
        final cachedItem = params['cachedItem'];
        final metadata = <String, dynamic>{
          'threadId': threadId,
          'turnId': (params['turnId'] ?? params['turn_id'])?.toString(),
          'itemId': (params['itemId'] ?? params['item_id'])?.toString(),
          'method': message.method,
        };
        final proposed =
            params['proposedExecpolicyAmendment'] ??
            params['proposed_execpolicy_amendment'];
        if (proposed != null) {
          metadata['proposedExecpolicyAmendment'] = proposed;
        }
        final reason = params['reason'];
        if (reason != null) {
          metadata['reason'] = reason;
        }

        String? command;
        if (cachedItem is Map<String, dynamic>) {
          final itemType = cachedItem['type'] as String?;
          if (itemType == 'commandExecution') {
            command = cachedItem['command'] as String?;
          } else if (itemType == 'fileChange') {
            final changes = cachedItem['changes'];
            if (changes is List && changes.isNotEmpty) {
              final first = changes.first;
              if (first is Map<String, dynamic>) {
                metadata['filePath'] = first['path'];
                metadata['diff'] = first['diff'];
              }
            }
          }
        }

        final title = message.method == 'item/commandExecution/requestApproval'
            ? 'Allow command execution?'
            : 'Allow file changes?';

        final request = PermissionRequest(
          id: message.requestId,
          sessionId: threadId ?? (state.cxThreadId ?? ''),
          title: title,
          command: command,
          metadata: metadata,
        );

        state = state.copyWith(permissions: [request, ...state.permissions]);
      }

      return;
    }

    if (message is! CodexNotificationMessage) return;

    final method = message.method;
    final params = message.params;
    final threadId = (params['threadId'] ?? params['thread_id'])?.toString();
    if (threadId != null &&
        threadId.isNotEmpty &&
        state.cxThreadId != null &&
        state.cxThreadId != threadId) {
      return;
    }

    if (method == 'rawResponseItem/completed') {
      final item = params['item'];
      if (item is Map) {
        final type = item['type']?.toString() ?? '';
        final callId =
            (item['call_id'] ?? item['callId'] ?? item['id'])?.toString() ?? '';

        String? toolName;
        Object? toolInputValue;
        Map<String, dynamic>? toolInput;
        String? toolOutput;
        var status = 'completed';

        Object? tryParseJsonString(String? raw) {
          if (raw == null) return null;
          final trimmed = raw.trim();
          if (trimmed.isEmpty) return null;
          try {
            return jsonDecode(trimmed);
          } catch (_) {
            return trimmed;
          }
        }

        if (type == 'function_call') {
          toolName = item['name']?.toString();
          toolInputValue = tryParseJsonString(item['arguments']?.toString());
          status = 'running';
        } else if (type == 'function_call_output') {
          toolOutput = item['output'] is String
              ? item['output']?.toString()
              : jsonEncode(item['output']);
          status = 'completed';
        } else if (type == 'custom_tool_call') {
          toolName = item['name']?.toString();
          toolInputValue = tryParseJsonString(item['input']?.toString());
          status = 'running';
        } else if (type == 'custom_tool_call_output') {
          toolOutput = item['output']?.toString();
          status = 'completed';
        }

        if (toolInputValue is Map) {
          toolInput = toolInputValue.cast<String, dynamic>();
        } else if (toolInputValue != null) {
          toolInput = {'value': toolInputValue};
        }

        if (callId.isNotEmpty &&
            (toolName != null ||
                toolOutput != null ||
                _cxPendingToolCallsById.containsKey(callId))) {
          final existing = _cxPendingToolCallsById[callId];

          if (existing != null) {
            _cxPendingToolCallsById[callId] = existing.copyWith(
              input: toolInput ?? existing.input,
              output: toolOutput ?? existing.output,
              status: status,
            );
          } else if (toolName != null) {
            _cxPendingToolCallsById[callId] = ToolCall(
              callId: callId,
              partId: callId,
              name: toolName,
              title: toolName,
              status: status,
              input: toolInput ?? item.cast<String, dynamic>(),
              output: toolOutput,
              metadata: const <String, dynamic>{'source': 'rawResponseItem'},
            );
            _cxOrderedParts.add(
              ToolPart(sequence: _cxPartSequence++, callId: callId),
            );
          } else if (toolOutput != null) {
            _cxPendingToolCallsById[callId] = ToolCall(
              callId: callId,
              partId: callId,
              name: 'Tool',
              title: 'Tool',
              status: 'completed',
              input: item.cast<String, dynamic>(),
              output: toolOutput,
              metadata: const <String, dynamic>{'source': 'rawResponseItem'},
            );
            _cxOrderedParts.add(
              ToolPart(sequence: _cxPartSequence++, callId: callId),
            );
          }

          _cxScheduleAssistantUpdate(isStreaming: state.cxIsStreaming);
        }
      }
      return;
    }

    if (method == 'thread/started') {
      final thread = params['thread'];
      if (thread is Map<String, dynamic>) {
        final id = thread['id']?.toString() ?? '';
        final cwd = thread['cwd']?.toString() ?? state.cxCwd;
        if (id.isNotEmpty &&
            (state.cxThreadId == null || state.cxThreadId!.isEmpty)) {
          state = state.copyWith(cxThreadId: id, cxCwd: cwd);
          _bridge.setView(sessionId: id, agent: 'codex');
        }
      }
      return;
    }

    if (method == 'turn/started') {
      state = state.copyWith(cxIsStreaming: true);
      return;
    }

    if (method == 'turn/completed') {
      state = state.copyWith(cxIsStreaming: false);
      // Trigger a final message update with isStreaming: false
      // This ensures the message's isStreaming flag is cleared
      _cxScheduleAssistantUpdate(isStreaming: false);
      return;
    }

    // Handle turn failures (e.g., model not available, API errors)
    if (method == 'turn/failed') {
      state = state.copyWith(cxIsStreaming: false);
      final turn = params['turn'];
      final error = turn is Map<String, dynamic>
          ? turn['error']
          : params['error'];
      String errorMessage = 'Turn failed';
      if (error is Map<String, dynamic>) {
        errorMessage = error['message']?.toString() ?? errorMessage;
      } else if (error is String) {
        errorMessage = error;
      }
      final errorMsg = ChatMessage(
        id: 'cx-error-${DateTime.now().microsecondsSinceEpoch}',
        sessionId: state.cxThreadId ?? '',
        role: MessageRole.system,
        createdAt: DateTime.now(),
        text: errorMessage,
        error: 'turn_failed',
      );
      _addMessage(errorMsg);
      return;
    }

    // Handle error notifications (unrecoverable errors)
    if (method == 'error') {
      state = state.copyWith(cxIsStreaming: false);
      final error = params['error'];
      String errorMessage = 'An error occurred';
      if (error is Map<String, dynamic>) {
        errorMessage = error['message']?.toString() ?? errorMessage;
      } else if (error is String) {
        errorMessage = error;
      } else if (params['message'] is String) {
        errorMessage = params['message'] as String;
      }
      final errorMsg = ChatMessage(
        id: 'cx-error-${DateTime.now().microsecondsSinceEpoch}',
        sessionId: state.cxThreadId ?? '',
        role: MessageRole.system,
        createdAt: DateTime.now(),
        text: errorMessage,
        error: 'codex_error',
      );
      _addMessage(errorMsg);
      return;
    }

    if (method == 'thread/tokenUsage/updated') {
      final tokenUsage = params['tokenUsage'];
      if (tokenUsage is Map<String, dynamic>) {
        state = state.copyWith(
          cxTokenUsage: CodexThreadTokenUsage.fromJson(tokenUsage),
        );
      }
      return;
    }

    if (method == 'turn/plan/updated') {
      final plan = params['plan'];
      if (plan is List) {
        final todos = <Todo>[];
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
      return;
    }

    if (method == 'turn/diff/updated') {
      final diff = params['diff']?.toString() ?? '';
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
      return;
    }

    if (method == 'item/agentMessage/delta') {
      final itemId = (params['itemId'] ?? params['item_id'])?.toString() ?? '';
      final delta = params['delta']?.toString() ?? '';
      if (itemId.isEmpty || delta.isEmpty) return;

      if (_cxCurrentAssistantMessageId != itemId) {
        _cxCurrentAssistantMessageId = itemId;
        _cxAssistantTextBuffer.clear();
        _cxPendingToolCallsById.clear();
        _cxOrderedParts.clear();
        _cxPartSequence = 0;
        _cxCurrentTextPartIndex = -1;
      }

      _cxAssistantTextBuffer.write(delta);

      if (_cxCurrentTextPartIndex >= 0 &&
          _cxCurrentTextPartIndex < _cxOrderedParts.length) {
        final existing = _cxOrderedParts[_cxCurrentTextPartIndex] as TextPart;
        _cxOrderedParts[_cxCurrentTextPartIndex] = existing.copyWith(
          text: existing.text + delta,
          isStreaming: true,
        );
      } else {
        _cxCurrentTextPartIndex = _cxOrderedParts.length;
        _cxOrderedParts.add(
          TextPart(sequence: _cxPartSequence++, text: delta, isStreaming: true),
        );
      }

      _cxScheduleAssistantUpdate(isStreaming: true);
      return;
    }

    if (method == 'item/reasoning/summaryTextDelta' ||
        method == 'item/reasoning/textDelta') {
      final itemId = (params['itemId'] ?? params['item_id'])?.toString() ?? '';
      final delta = params['delta']?.toString() ?? '';
      if (itemId.isEmpty || delta.isEmpty) return;
      _cxThinkingPartId = itemId;
      _cxThinkingBuffer.write(delta);
      _cxScheduleAssistantUpdate(isStreaming: true);
      return;
    }

    if (method == 'item/started' || method == 'item/completed') {
      final item = params['item'];
      if (item is! Map<String, dynamic>) return;
      final type = item['type']?.toString() ?? '';
      final itemId = item['id']?.toString() ?? '';
      if (itemId.isEmpty) return;

      if (type == 'commandExecution' ||
          type == 'fileChange' ||
          type == 'mcpToolCall' ||
          type == 'webSearch' ||
          type == 'enteredReviewMode' ||
          type == 'exitedReviewMode') {
        final toolName = switch (type) {
          'commandExecution' => 'Bash',
          'fileChange' => 'ApplyPatch',
          'mcpToolCall' =>
            '${item['server'] ?? ''}.${item['tool'] ?? ''}'.replaceFirst(
              '.',
              '',
            ),
          'enteredReviewMode' || 'exitedReviewMode' => 'Review',
          _ => 'WebSearch',
        };

        final statusRaw = item['status']?.toString().toLowerCase() ?? '';
        final status = statusRaw.contains('completed')
            ? 'completed'
            : statusRaw.contains('failed')
            ? 'failed'
            : statusRaw.contains('declined')
            ? 'declined'
            : 'running';

        final toolCall = ToolCall(
          callId: itemId,
          partId: itemId,
          name: toolName,
          status: status,
          title: toolName,
          input: item,
          output:
              (type == 'exitedReviewMode'
                  ? item['review']?.toString()
                  : item['aggregatedOutput']?.toString()) ??
              item['review']?.toString(),
          metadata: const <String, dynamic>{},
        );

        _cxPendingToolCallsById[itemId] = toolCall;
        // Only add a new ToolPart if one doesn't already exist for this callId
        // (item/started and item/completed both call this code for same itemId)
        final alreadyHasPart = _cxOrderedParts.any(
          (p) => p is ToolPart && p.callId == itemId,
        );
        if (!alreadyHasPart) {
          _cxOrderedParts.add(
            ToolPart(sequence: _cxPartSequence++, callId: itemId),
          );
        }
        _cxScheduleAssistantUpdate(isStreaming: state.cxIsStreaming);

        if (type == 'fileChange') {
          final changes = item['changes'];
          if (changes is List) {
            final diffs = <DiffEntry>[];
            for (final c in changes) {
              if (c is! Map<String, dynamic>) continue;
              final file = c['path']?.toString() ?? '';
              final diff = c['diff']?.toString() ?? '';
              if (file.isEmpty || diff.trim().isEmpty) continue;
              final (adds, dels) = _countUnifiedDiffAddsDels(diff);
              diffs.add(
                DiffEntry(
                  file: file,
                  before: '',
                  after: '',
                  additions: adds,
                  deletions: dels,
                  diff: diff,
                  partId: itemId,
                ),
              );
            }
            if (diffs.isNotEmpty) {
              state = state.copyWith(
                sessionDiffs: [...state.sessionDiffs, ...diffs],
              );
            }
          }
        }
      }

      return;
    }

    if (method == 'item/commandExecution/outputDelta') {
      final itemId = (params['itemId'] ?? params['item_id'])?.toString() ?? '';
      final delta = params['delta']?.toString() ?? '';
      if (itemId.isEmpty || delta.isEmpty) return;
      final existing = _cxPendingToolCallsById[itemId];
      if (existing == null) return;
      _cxPendingToolCallsById[itemId] = existing.copyWith(
        output: '${existing.output ?? ''}$delta',
      );
      _cxScheduleAssistantUpdate(isStreaming: true);
      return;
    }

    // Multi-Agent Collaboration Events (Codex SDK v0.87.0+)
    _handleCodexCollabEvent(method, params);
  }

  /// Handle multi-agent collaboration events (SDK v0.87.0+)
  void _handleCodexCollabEvent(String method, Map<String, dynamic> params) {
    // Parse common fields
    // ignore: unused_local_variable
    final callId = (params['callId'] ?? params['call_id'])?.toString() ?? '';
    final senderThreadId =
        (params['senderThreadId'] ?? params['sender_thread_id'])?.toString() ??
        state.cxThreadId ??
        '';
    final receiverThreadId =
        (params['receiverThreadId'] ?? params['receiver_thread_id'])
            ?.toString();
    final newThreadId = (params['newThreadId'] ?? params['new_thread_id'])
        ?.toString();
    final prompt = params['prompt']?.toString();

    // Parse status (can be a map or string)
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

    // Initialize tree if needed
    CodexCollabAgentTree getOrCreateTree() {
      return state.cxCollabTree ??
          CodexCollabAgentTree(rootThreadId: state.cxThreadId ?? '');
    }

    switch (method) {
      // collab/agentSpawn/begin
      case 'collab/agentSpawn/begin':
      case 'collab_agentSpawn_begin':
        if (kDebugMode) {
          developer.log(
            'Collab: Spawning agent from $senderThreadId',
            name: 'ChatProvider',
          );
        }
        break;

      // collab/agentSpawn/end
      case 'collab/agentSpawn/end':
      case 'collab_agentSpawn_end':
        if (newThreadId != null && newThreadId.isNotEmpty) {
          final tree = getOrCreateTree();
          tree.addNode(
            CodexCollabAgentNode(
              threadId: newThreadId,
              parentThreadId: senderThreadId,
              status: status ?? CodexCollabAgentStatus.running,
              prompt: prompt,
              startedAt: DateTime.now(),
            ),
          );
          state = state.copyWith(cxCollabTree: tree);
        }
        break;

      // collab/agentInteraction/begin
      case 'collab/agentInteraction/begin':
      case 'collab_agentInteraction_begin':
        if (kDebugMode) {
          developer.log(
            'Collab: Interaction $senderThreadId -> $receiverThreadId',
            name: 'ChatProvider',
          );
        }
        break;

      // collab/agentInteraction/end
      case 'collab/agentInteraction/end':
      case 'collab_agentInteraction_end':
        if (receiverThreadId != null && status != null) {
          final tree = state.cxCollabTree;
          if (tree != null) {
            tree.updateStatus(receiverThreadId, status);
            state = state.copyWith(cxCollabTree: tree);
          }
        }
        break;

      // collab/waiting/begin
      case 'collab/waiting/begin':
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
        break;

      // collab/waiting/end
      case 'collab/waiting/end':
      case 'collab_waiting_end':
        // Update all agent statuses from the statuses map
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
        break;

      // collab/close/begin
      case 'collab/close/begin':
      case 'collab_close_begin':
        if (kDebugMode) {
          developer.log(
            'Collab: Closing agent $receiverThreadId',
            name: 'ChatProvider',
          );
        }
        break;

      // collab/close/end
      case 'collab/close/end':
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
        break;
    }
  }

  void _cxScheduleAssistantUpdate({required bool isStreaming}) {
    // If transitioning to non-streaming (turn/completed), cancel pending timer
    // and schedule immediately to ensure the final state is rendered
    if (!isStreaming && _cxUpdateTimer != null) {
      _cxUpdateTimer!.cancel();
      _cxUpdateTimer = null;
    }
    if (_cxUpdateTimer != null) return;
    _cxUpdateTimer = Timer(const Duration(milliseconds: 24), () {
      _cxUpdateTimer = null;
      _updateCodexAssistantMessage(isStreaming: isStreaming);
    });
  }

  void _updateCodexAssistantMessage({required bool isStreaming}) {
    final msgId = _cxCurrentAssistantMessageId.isNotEmpty
        ? _cxCurrentAssistantMessageId
        : 'cx-assistant';
    final text = _cxAssistantTextBuffer.toString();

    final reasoningParts = <ReasoningPart>[];
    if (_cxThinkingBuffer.toString().trim().isNotEmpty) {
      reasoningParts.add(
        ReasoningPart(
          id: _cxThinkingPartId.isNotEmpty ? _cxThinkingPartId : 'cx-thinking',
          messageId: msgId,
          text: _cxThinkingBuffer.toString(),
          isStreaming: isStreaming,
        ),
      );
    }

    final orderedParts = <MessagePart>[];
    for (int i = 0; i < _cxOrderedParts.length; i++) {
      final part = _cxOrderedParts[i];
      if (part is TextPart) {
        final isLastTextPart = i == _cxCurrentTextPartIndex;
        orderedParts.add(
          part.copyWith(isStreaming: isLastTextPart && isStreaming),
        );
      } else {
        orderedParts.add(part);
      }
    }

    if (_cxCurrentTextPartIndex >= 0 &&
        _cxCurrentTextPartIndex < _cxOrderedParts.length) {
      // ok, already has a text part
    } else if (text.trim().isNotEmpty) {
      orderedParts.add(
        TextPart(
          sequence: _cxPartSequence++,
          text: text,
          isStreaming: isStreaming,
        ),
      );
    }

    final message = ChatMessage(
      id: msgId,
      sessionId: state.cxThreadId ?? '',
      role: MessageRole.assistant,
      createdAt: DateTime.now(),
      text: text,
      toolCalls: List<ToolCall>.unmodifiable(_cxPendingToolCallsById.values),
      diffs: state.sessionDiffs,
      reasoningParts: reasoningParts,
      parts: List<MessagePart>.unmodifiable(orderedParts),
      isStreaming: isStreaming,
    );

    _updateMessage(msgId, message);
  }

  /// Set Codex streaming state (called when sending a message)
  void setCodexStreaming(bool isStreaming) {
    state = state.copyWith(cxIsStreaming: isStreaming);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _ccSubscription?.cancel();
    _cxSubscription?.cancel();
    _rawSubscription?.cancel();
    _flushTimer?.cancel();
    _textDebounceTimer?.cancel();
    _ccUpdateTimer?.cancel();
    _cxUpdateTimer?.cancel();
    super.dispose();
  }
}

final chatSessionProvider =
    StateNotifierProvider<ChatSessionNotifier, ChatSessionState>((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      return ChatSessionNotifier(bridge);
    });
