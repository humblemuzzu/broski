import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
    this.todos = const [],
    this.vcsInfo,
    this.isCompacting = false,
    this.sessionStatus =
        const SessionStatus.idle(), // Feature 13: Session status
  });

  final SessionSummary? session;
  final String? projectPath;
  final List<ChatMessage> messages;
  final List<PermissionRequest> permissions;
  final List<Todo> todos;
  final VcsInfo? vcsInfo; // Feature 10: Git branch info
  final bool isCompacting; // Feature 9: Compaction in progress
  final SessionStatus
  sessionStatus; // Feature 13: Session status (idle/busy/retry)

  ChatSessionState copyWith({
    SessionSummary? session,
    String? projectPath,
    List<ChatMessage>? messages,
    List<PermissionRequest>? permissions,
    List<Todo>? todos,
    VcsInfo? vcsInfo,
    bool? isCompacting,
    SessionStatus? sessionStatus,
  }) {
    return ChatSessionState(
      session: session ?? this.session,
      projectPath: projectPath ?? this.projectPath,
      messages: messages ?? this.messages,
      permissions: permissions ?? this.permissions,
      todos: todos ?? this.todos,
      vcsInfo: vcsInfo ?? this.vcsInfo,
      isCompacting: isCompacting ?? this.isCompacting,
      sessionStatus: sessionStatus ?? this.sessionStatus,
    );
  }
}

class ChatSessionNotifier extends StateNotifier<ChatSessionState> {
  ChatSessionNotifier(this._bridge) : super(const ChatSessionState()) {
    _subscription = _bridge.sdkEvents.listen(_enqueueSdkEvent);
  }

  final BridgeService _bridge;
  final Map<String, ChatMessage> _messages = {};
  final List<String> _order = [];
  StreamSubscription<Map<String, dynamic>>? _subscription;

  final List<Map<String, dynamic>> _pendingEvents = [];
  Timer? _flushTimer;
  bool _suppressEmit = false;
  bool _pendingEmitMessages = false;

  void setSession(SessionSummary session, {String? projectPath}) {
    _messages.clear();
    _order.clear();
    state = ChatSessionState(
      session: session,
      projectPath: projectPath,
      messages: const [],
      permissions: const [],
      todos: const [],
    );
  }

  void hydrate(List<dynamic> rawMessages) {
    _messages.clear();
    _order.clear();

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

      for (final partItem in parts) {
        final part = partItem as Map<String, dynamic>;
        final partType = part['type'] as String? ?? '';
        if (partType == 'text') {
          textBuffer.write(part['text'] as String? ?? '');
        }
        if (partType == 'tool') {
          final callId = part['callID'] as String? ?? '';
          final toolName = part['tool'] as String? ?? 'tool';
          final stateInfo = part['state'] as Map<String, dynamic>? ?? const {};
          final status = stateInfo['status'] as String? ?? 'completed';
          final title = stateInfo['title'] as String?;
          final input = stateInfo['input'] as Map<String, dynamic>? ?? const {};
          final output = stateInfo['output'] as String?;
          if (callId.isNotEmpty) {
            tools.add(
              ToolCall(
                callId: callId,
                name: toolName,
                status: status,
                title: title,
                input: input,
                output: output,
              ),
            );
          }
        }
      }

      final message = ChatMessage(
        id: messageId,
        sessionId: sessionId,
        role: role == 'user' ? MessageRole.user : MessageRole.assistant,
        createdAt: DateTime.fromMillisecondsSinceEpoch(created),
        text: textBuffer.toString(),
        toolCalls: tools,
      );

      _addMessage(message);
    }
  }

  void appendUserMessage(String content) {
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

  void resolvePermission(String permissionId) {
    state = state.copyWith(
      permissions: state.permissions
          .where((item) => item.id != permissionId)
          .toList(),
    );
  }

  void _enqueueSdkEvent(Map<String, dynamic> event) {
    _pendingEvents.add(event);
    _flushTimer ??= Timer(const Duration(milliseconds: 16), _flushSdkEvents);
  }

  void _flushSdkEvents() {
    _flushTimer = null;
    if (_pendingEvents.isEmpty) return;

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
    final partType = part['type'] as String? ?? '';
    if (partType == 'text' && existingMessage == null) {
      final partText = part['text'] as String? ?? '';
      final isUserEcho = _messages.values.any(
        (msg) => msg.role == MessageRole.user && msg.text == partText,
      );
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
      final delta = properties['delta'] as String?;
      final text = part['text'] as String? ?? '';
      final updated = delta != null ? message.text + delta : text;
      _updateMessage(
        messageId,
        message.copyWith(text: updated, isStreaming: delta != null),
      );
      return;
    }

    if (partType == 'tool') {
      final callId = part['callID'] as String? ?? '';
      final toolName = part['tool'] as String? ?? 'tool';
      final stateInfo = part['state'] as Map<String, dynamic>? ?? const {};
      final status = stateInfo['status'] as String? ?? 'pending';
      final title = stateInfo['title'] as String?;
      final input = stateInfo['input'] as Map<String, dynamic>? ?? const {};
      final output = stateInfo['output'] as String?;

      final existing = message.toolCalls
          .where((tool) => tool.callId == callId)
          .toList();
      final updatedTool =
          (existing.isNotEmpty ? existing.first : null)?.copyWith(
            status: status,
            title: title,
            input: input,
            output: output,
          ) ??
          ToolCall(
            callId: callId,
            name: toolName,
            status: status,
            title: title,
            input: input,
            output: output,
          );

      final updatedTools = [
        for (final tool in message.toolCalls)
          if (tool.callId != callId) tool,
        updatedTool,
      ];

      _updateMessage(messageId, message.copyWith(toolCalls: updatedTools));
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

    // Skip empty diffs
    if (diffs.isEmpty) return;

    final messageId = 'diff-${DateTime.now().millisecondsSinceEpoch}';
    final message = ChatMessage(
      id: messageId,
      sessionId: sessionId,
      role: MessageRole.system,
      createdAt: DateTime.now(),
      text: 'Session diff',
      diffs: diffs,
    );
    _addMessage(message);
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
    state = state.copyWith(messages: list);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _flushTimer?.cancel();
    super.dispose();
  }
}

final chatSessionProvider =
    StateNotifierProvider<ChatSessionNotifier, ChatSessionState>((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      return ChatSessionNotifier(bridge);
    });
