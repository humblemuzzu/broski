part of '../bridge_service.dart';

/// Session actions: chat, permissions, todos, commands, diffs.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceSessionsActions on BridgeService {
  // ============================================================
  // Chat & Communication
  // ============================================================

  /// Send a chat message (protected against duplicate sends during lag)
  void sendChat({
    required String sessionId,
    required String content,
    String? messageId,
    String? projectPath,
    String? providerID,
    String? modelID,
    String? agent,
    List<FileAttachment>? fileAttachments,
    String? variant,
    bool? noReply,
    String? system,
  }) {
    final contentHash = content.hashCode;
    final guardKey = 'chat:$sessionId:$contentHash';

    if (!_guardFireAndForget(guardKey, cooldown: const Duration(seconds: 2))) {
      return;
    }

    _socket.send({
      'type': 'chat',
      'sessionId': sessionId,
      'content': content,
      if (messageId != null) 'messageId': messageId,
      if (projectPath != null) 'projectPath': projectPath,
      if (providerID != null && modelID != null)
        'model': {'providerID': providerID, 'modelID': modelID},
      if (agent != null) 'agent': agent,
      if (fileAttachments != null && fileAttachments.isNotEmpty)
        'fileAttachments': fileAttachments.map((f) => f.toJson()).toList(),
      if (variant != null && variant.isNotEmpty) 'variant': variant,
      if (noReply != null) 'noReply': noReply,
      if (system != null && system.isNotEmpty) 'system': system,
    });
  }

  void abortSession(String sessionId, {String? projectPath}) {
    _socket.send({
      'type': 'abort',
      'sessionId': sessionId,
      if (projectPath != null) 'projectPath': projectPath,
    });
  }

  /// Respond to a permission request (protected against duplicate responses)
  void respondToPermission({
    required String sessionId,
    required String permissionId,
    required String response,
    String? message,
    String? projectPath,
  }) {
    final guardKey = 'permission:$permissionId';

    if (!_guardFireAndForget(guardKey, cooldown: const Duration(seconds: 5))) {
      return;
    }

    _socket.send({
      'type': 'permission_response',
      'sessionId': sessionId,
      'permissionId': permissionId,
      'response': response,
      if (message != null && message.isNotEmpty) 'message': message,
      if (projectPath != null) 'projectPath': projectPath,
    });
  }

  Future<Map<String, dynamic>> getSessionContext(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_session_context',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_context', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  Future<List<dynamic>> getSessionDiff(
    String sessionId, {
    String? projectPath,
    String? messageId,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'diff',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (messageId != null) 'messageId': messageId,
    });
    final response = await _waitFor('diff', requestId: requestId);
    return response['data'] as List<dynamic>? ?? [];
  }

  // ============================================================
  // Todos & Commands
  // ============================================================

  Future<List<Todo>> getTodos(String sessionId, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_todos',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('todos', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => Todo.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<SlashCommand>> listCommands({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_commands',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('commands', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => SlashCommand.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  /// Execute a slash command (protected against duplicate executions)
  void executeCommand({
    required String sessionId,
    required String command,
    required String arguments,
    String? projectPath,
    String? agent,
    String? model,
    String? variant,
    List<Map<String, dynamic>>? parts,
  }) {
    final guardKey = 'command:$sessionId:$command:${arguments.hashCode}';

    if (!_guardFireAndForget(guardKey, cooldown: const Duration(seconds: 2))) {
      return;
    }

    _socket.send({
      'type': 'execute_command',
      'sessionId': sessionId,
      'command': command,
      'arguments': arguments,
      if (projectPath != null) 'projectPath': projectPath,
      if (agent != null) 'agent': agent,
      if (model != null) 'model': model,
      if (variant != null && variant.isNotEmpty) 'variant': variant,
      if (parts != null && parts.isNotEmpty) 'parts': parts,
    });
  }
}
