import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/message.dart';
import '../models/session.dart';
import '../models/todo.dart';
import '../models/vcs.dart';
import '../services/bridge_service.dart';
import 'service_providers.dart';

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
    // FIX: Track content length incrementally instead of recalculating every frame
    this.contentLength = 0,
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

  // FIX: Pre-computed content length for efficient auto-scroll detection
  final int contentLength;

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
    int? contentLength,
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
      contentLength: contentLength ?? this.contentLength,
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
  }

  final BridgeService _bridge;
  final Map<String, ChatMessage> _messages = {};
  final List<String> _order = [];
  StreamSubscription<Map<String, dynamic>>? _subscription;
  StreamSubscription<ClaudeCodeStreamMessage>? _ccSubscription;
  StreamSubscription<CodexStreamMessage>? _cxSubscription;

  final List<Map<String, dynamic>> _pendingEvents = [];
  Timer? _flushTimer;
  bool _suppressEmit = false;
  bool _pendingEmitMessages = false;

  Timer? _textDebounceTimer;
  final Map<String, StringBuffer> _pendingTextBuffers = {};
  int _lastRttMs = 0;
  bool _lspStatusFetched = false;

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
  }

  void setCCModel(String? model) {
    if (!state.isClaudeCode) return;
    state = state.copyWith(ccModel: model);
  }

  void setCodexThread({
    required String threadId,
    required String cwd,
    String? model,
  }) {
    _sessionVersion++;
    _messages.clear();
    _order.clear();
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
      final sessionId = info['sessionID'] as String? ?? '';
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
          final callId = part['callID'] as String? ?? '';
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

  void appendUserMessage(String content) {
    // Handle Claude Code mode
    if (state.isClaudeCode) {
      final sessionId = state.ccSessionId ?? '';
      final message = ChatMessage(
        id: 'local-${DateTime.now().microsecondsSinceEpoch}',
        sessionId: sessionId,
        role: MessageRole.user,
        createdAt: DateTime.now(),
        text: content,
      );
      _addMessage(message);
      return;
    }

    // Codex mode
    if (state.isCodex) {
      final threadId = state.cxThreadId ?? '';
      final message = ChatMessage(
        id: 'local-${DateTime.now().microsecondsSinceEpoch}',
        sessionId: threadId,
        role: MessageRole.user,
        createdAt: DateTime.now(),
        text: content,
      );
      _addMessage(message);
      return;
    }

    // OpenCode mode
    final session = state.session;
    if (session == null) return;

    final message = ChatMessage(
      id: 'local-${DateTime.now().microsecondsSinceEpoch}',
      sessionId: session.id,
      role: MessageRole.user,
      createdAt: DateTime.now(),
      text: content,
    );
    _addMessage(message);
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
    // Filter by directory/project path first
    final eventDirectory = event['directory'] as String?;
    if (eventDirectory != null && state.projectPath != null) {
      if (eventDirectory != state.projectPath) {
        return;
      }
    }

    final payload = event['payload'] as Map<String, dynamic>? ?? const {};
    final type = payload['type'] as String?;
    if (type == null) return;

    switch (type) {
      case 'message.updated':
        _handleMessageUpdated(payload);
        break;
      case 'message.part.updated':
        _handleMessagePartUpdated(payload);
        break;
      case 'permission.updated':
        _handlePermissionUpdated(payload);
        break;
      case 'permission.replied':
        _handlePermissionReplied(payload);
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
      default:
        if (kDebugMode) {
          developer.log('Unhandled event type: $type', name: 'ChatProvider');
        }
        break;
    }
  }

  void _handleMessageUpdated(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final info = properties['info'] as Map<String, dynamic>?;
    if (info == null) return;
    final sessionId = info['sessionID'] as String? ?? '';
    if (state.session?.id != sessionId) return;

    final messageId = info['id'] as String? ?? '';
    final role = info['role'] as String? ?? 'assistant';
    final created =
        info['time']?['created'] as int? ??
        DateTime.now().millisecondsSinceEpoch;

    // Skip user messages - we already added them locally in appendUserMessage()
    if (role == 'user') {
      return;
    }

    if (!_messages.containsKey(messageId)) {
      final message = ChatMessage(
        id: messageId,
        sessionId: sessionId,
        role: role == 'user' ? MessageRole.user : MessageRole.assistant,
        createdAt: DateTime.fromMillisecondsSinceEpoch(created),
        text: '',
      );
      _addMessage(message);
    }
  }

  void _handleMessagePartUpdated(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final part = properties['part'] as Map<String, dynamic>? ?? const {};
    final sessionId = part['sessionID'] as String? ?? '';
    if (state.session?.id != sessionId) return;

    final messageId = part['messageID'] as String? ?? '';
    if (messageId.isEmpty) return;

    // Skip part updates for user messages - we already have them locally
    // User messages have local-* IDs or we should skip server-echoed user messages
    final existingMessage = _messages[messageId];
    if (existingMessage != null && existingMessage.role == MessageRole.user) {
      return;
    }

    // If we don't have this message yet, only create if it's NOT a user message
    // Check if any local user message contains similar text (to avoid duplicates)
    // Use startsWith to handle cases where local message has attachments appended
    final partType = part['type'] as String? ?? '';
    if (partType == 'text' && existingMessage == null) {
      final partText = part['text'] as String? ?? '';
      final isUserEcho = _messages.values.any((msg) {
        if (msg.role != MessageRole.user) return false;
        final msgText = msg.text.trim();
        final serverText = partText.trim();
        return msgText == serverText ||
            msgText.startsWith(serverText) ||
            serverText.startsWith(msgText);
      });
      if (isUserEcho) {
        return;
      }
    }

    final message =
        existingMessage ??
        ChatMessage(
          id: messageId,
          sessionId: sessionId,
          role: MessageRole.assistant,
          createdAt: DateTime.now(),
          text: '',
        );

    if (partType == 'text') {
      final isSynthetic = part['synthetic'] as bool? ?? false;
      final isIgnored = part['ignored'] as bool? ?? false;
      if (isSynthetic || isIgnored) {
        return;
      }

      final delta = properties['delta'] as String?;
      final text = part['text'] as String? ?? '';

      if (delta != null && _lastRttMs > 50) {
        _pendingTextBuffers.putIfAbsent(messageId, () => StringBuffer());
        _pendingTextBuffers[messageId]!.write(delta);

        _textDebounceTimer?.cancel();
        _textDebounceTimer = Timer(
          Duration(milliseconds: _lastRttMs.clamp(30, 100)),
          () => _flushPendingText(messageId, message),
        );
      } else {
        final updated = delta != null ? message.text + delta : text;
        _updateMessage(
          messageId,
          message.copyWith(text: updated, isStreaming: delta != null),
        );
      }
      return;
    }

    if (partType == 'tool') {
      final partId = part['id'] as String? ?? '';
      final callId = part['callID'] as String? ?? '';
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
    final sessionId = permission['sessionID'] as String? ?? '';
    if (state.session?.id != sessionId) return;

    final request = PermissionRequest(
      id: permission['id'] as String? ?? '',
      sessionId: sessionId,
      title: permission['title'] as String? ?? 'Permission required',
      command: permission['metadata']?['command'] as String?,
      metadata: permission['metadata'] as Map<String, dynamic>? ?? const {},
    );

    state = state.copyWith(permissions: [...state.permissions, request]);
  }

  void _handlePermissionReplied(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final permissionId = properties['permissionID'] as String? ?? '';
    if (permissionId.isEmpty) return;

    state = state.copyWith(
      permissions: state.permissions
          .where((item) => item.id != permissionId)
          .toList(),
    );
  }

  void _handleSessionDiff(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final sessionId = properties['sessionID'] as String? ?? '';
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
    final sessionId = properties['sessionID'] as String? ?? '';
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
    final sessionId = properties['sessionID'] as String? ?? '';
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
    final sessionId = properties['sessionID'] as String? ?? '';
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
    final sessionId = properties['sessionID'] as String? ?? '';
    if (state.session?.id != sessionId) return;

    final statusData =
        properties['status'] as Map<String, dynamic>? ?? const {};
    final status = SessionStatus.fromJson(statusData);

    developer.log(
      'Session status updated: ${status.displayString}',
      name: 'ChatProvider',
    );
    state = state.copyWith(sessionStatus: status);
  }

  void _handleSessionIdle(Map<String, dynamic> payload) {
    final properties =
        payload['properties'] as Map<String, dynamic>? ?? const {};
    final sessionId = properties['sessionID'] as String? ?? '';
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

    if (message is CCSessionCreated) {
      // Session started - update model if provided
      state = state.copyWith(
        ccSessionId: message.sessionId.isNotEmpty
            ? message.sessionId
            : state.ccSessionId,
        ccModel: message.model ?? state.ccModel,
        ccIsStreaming: true,
      );
      return;
    }

    if (message is CCSessionInit) {
      state = state.copyWith(
        ccSessionId: message.sessionId.isNotEmpty
            ? message.sessionId
            : state.ccSessionId,
        ccModel: message.model.isNotEmpty ? message.model : state.ccModel,
        ccInit: message,
        ccIsStreaming: true,
      );
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
      // Complete assistant message (if server sends full message)
      _ccAssistantTextBuffer.clear();
      _ccAssistantTextBuffer.write(message.content);
      _ensureCCHasRenderableTextPart(isStreaming: false);
      _flushCCAssistantUpdate(isStreaming: false);
      return;
    }

    if (message is CCThinkingDelta) {
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

      if (message.method == 'item/commandExecution/requestApproval' ||
          message.method == 'item/fileChange/requestApproval') {
        final cachedItem = params['cachedItem'];
        final metadata = <String, dynamic>{
          'threadId': threadId,
          'turnId': (params['turnId'] ?? params['turn_id'])?.toString(),
          'itemId': (params['itemId'] ?? params['item_id'])?.toString(),
          'method': message.method,
        };

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

    if (method == 'thread/started') {
      final thread = params['thread'];
      if (thread is Map<String, dynamic>) {
        final id = thread['id']?.toString() ?? '';
        final cwd = thread['cwd']?.toString() ?? state.cxCwd;
        if (id.isNotEmpty &&
            (state.cxThreadId == null || state.cxThreadId!.isEmpty)) {
          state = state.copyWith(cxThreadId: id, cxCwd: cwd);
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
      return;
    }

    if (method == 'thread/tokenUsage/updated') {
      final tokenUsage = params['tokenUsage'];
      if (tokenUsage is Map<String, dynamic>) {
        state = state.copyWith(cxTokenUsage: CodexThreadTokenUsage.fromJson(tokenUsage));
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
          output: (type == 'exitedReviewMode'
                  ? item['review']?.toString()
                  : item['aggregatedOutput']?.toString()) ??
              item['review']?.toString(),
          metadata: const <String, dynamic>{},
        );

        _cxPendingToolCallsById[itemId] = toolCall;
        _cxOrderedParts.add(
          ToolPart(sequence: _cxPartSequence++, callId: itemId),
        );
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
  }

  void _cxScheduleAssistantUpdate({required bool isStreaming}) {
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
