import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/message.dart';
import '../models/session.dart';
import '../services/bridge_service.dart';
import 'service_providers.dart';

class ChatSessionState {
  const ChatSessionState({
    this.session,
    this.projectPath,
    this.messages = const [],
    this.permissions = const [],
  });

  final SessionSummary? session;
  final String? projectPath;
  final List<ChatMessage> messages;
  final List<PermissionRequest> permissions;

  ChatSessionState copyWith({
    SessionSummary? session,
    String? projectPath,
    List<ChatMessage>? messages,
    List<PermissionRequest>? permissions,
  }) {
    return ChatSessionState(
      session: session ?? this.session,
      projectPath: projectPath ?? this.projectPath,
      messages: messages ?? this.messages,
      permissions: permissions ?? this.permissions,
    );
  }
}

class ChatSessionNotifier extends StateNotifier<ChatSessionState> {
  ChatSessionNotifier(this._bridge) : super(const ChatSessionState()) {
    _subscription = _bridge.sdkEvents.listen(_handleSdkEvent);
  }

  final BridgeService _bridge;
  final Map<String, ChatMessage> _messages = {};
  final List<String> _order = [];
  StreamSubscription<Map<String, dynamic>>? _subscription;

  void setSession(SessionSummary session, {String? projectPath}) {
    _messages.clear();
    _order.clear();
    state = ChatSessionState(
      session: session,
      projectPath: projectPath,
      messages: const [],
      permissions: const [],
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

  void _handleSdkEvent(Map<String, dynamic> event) {
    developer.log('SDK Event received: $event', name: 'ChatProvider');

    // Filter by directory/project path first
    final eventDirectory = event['directory'] as String?;
    if (eventDirectory != null && state.projectPath != null) {
      if (eventDirectory != state.projectPath) {
        developer.log(
          'Ignoring event from different project: $eventDirectory (current: ${state.projectPath})',
          name: 'ChatProvider',
        );
        return;
      }
    }

    final payload = event['payload'] as Map<String, dynamic>? ?? const {};
    final type = payload['type'] as String?;
    developer.log('Event type: $type', name: 'ChatProvider');
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
      default:
        developer.log('Unhandled event type: $type', name: 'ChatProvider');
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
      developer.log(
        'Skipping user message from server (already added locally)',
        name: 'ChatProvider',
      );
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
      developer.log(
        'Skipping part update for user message: $messageId',
        name: 'ChatProvider',
      );
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
        developer.log(
          'Skipping echoed user message text: $partText',
          name: 'ChatProvider',
        );
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

    developer.log(
      'Session error: $errorName - $errorMessage',
      name: 'ChatProvider',
    );

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

  void _addMessage(ChatMessage message) {
    if (!_messages.containsKey(message.id)) {
      _order.add(message.id);
    }
    _messages[message.id] = message;
    _emitMessages();
  }

  void _updateMessage(String id, ChatMessage message) {
    if (!_messages.containsKey(id)) {
      _order.add(id);
    }
    _messages[id] = message;
    _emitMessages();
  }

  void _emitMessages() {
    final list = _order.map((id) => _messages[id]!).toList();
    state = state.copyWith(messages: list);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}

final chatSessionProvider =
    StateNotifierProvider<ChatSessionNotifier, ChatSessionState>((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      return ChatSessionNotifier(bridge);
    });
