import 'dart:async';
import 'dart:math';

import '../models/project.dart';
import '../models/session.dart';
import 'websocket_service.dart';

class BridgeService {
  BridgeService(this._socket);

  final WebSocketService _socket;
  final _random = Random();
  int _requestCounter = 0;

  Stream<Map<String, dynamic>> get messages => _socket.messages;

  Stream<Map<String, dynamic>> get sdkEvents => _socket.messages
      .where((message) => message['type'] == 'sdk_event')
      .map((message) => message['data'] as Map<String, dynamic>);

  String _generateRequestId() {
    _requestCounter++;
    return 'req_${_requestCounter}_${_random.nextInt(999999)}';
  }

  Future<List<ProjectSummary>> listProjects() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'list_projects', 'requestId': requestId});
    final response = await _waitFor('projects', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ProjectSummary.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<SessionSummary>> listSessions({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_sessions',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('sessions', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => SessionSummary.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<Map<String, dynamic>> listProviders() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'list_providers', 'requestId': requestId});
    final response = await _waitFor('providers', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<Map<String, dynamic>> getConfig() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'get_config', 'requestId': requestId});
    final response = await _waitFor('config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<Map<String, dynamic>> setModel(String model) async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'set_model', 'model': model, 'requestId': requestId});
    final response = await _waitFor('config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  void startOpenCode() {
    _socket.send({'type': 'start_opencode'});
  }

  Future<SessionSummary> createSession({
    String? projectPath,
    String? title,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'create_session',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (title != null) 'title': title,
    });
    final response = await _waitFor('session_created', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  Future<SessionSummary> getSession(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  Future<List<dynamic>> getSessionMessages(
    String sessionId, {
    String? projectPath,
    int? limit,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_session_messages',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (limit != null) 'limit': limit,
    });
    final response = await _waitFor('session_messages', requestId: requestId);
    return response['data'] as List<dynamic>? ?? [];
  }

  void sendChat({
    required String sessionId,
    required String content,
    String? projectPath,
    String? providerID,
    String? modelID,
  }) {
    _socket.send({
      'type': 'chat',
      'sessionId': sessionId,
      'content': content,
      if (projectPath != null) 'projectPath': projectPath,
      if (providerID != null && modelID != null)
        'model': {'providerID': providerID, 'modelID': modelID},
    });
  }

  void abortSession(String sessionId, {String? projectPath}) {
    _socket.send({
      'type': 'abort',
      'sessionId': sessionId,
      if (projectPath != null) 'projectPath': projectPath,
    });
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

  Future<List<dynamic>> browse(String path, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'browse',
      'path': path,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('browse_result', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['items'] as List<dynamic>? ?? [];
  }

  void respondToPermission({
    required String sessionId,
    required String permissionId,
    required String response,
    String? projectPath,
  }) {
    _socket.send({
      'type': 'permission_response',
      'sessionId': sessionId,
      'permissionId': permissionId,
      'response': response,
      if (projectPath != null) 'projectPath': projectPath,
    });
  }

  Future<List<dynamic>> getLspStatus({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_lsp_status',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('lsp_status', requestId: requestId);
    return response['data'] as List<dynamic>? ?? [];
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

  Future<Map<String, dynamic>> _waitFor(String type, {String? requestId}) {
    return _socket.messages
        .firstWhere((message) {
          if (message['type'] != type) return false;
          // If we have a requestId, match it; otherwise accept any matching type
          if (requestId != null && message['requestId'] != null) {
            return message['requestId'] == requestId;
          }
          return true;
        })
        .timeout(
          const Duration(seconds: 10),
          onTimeout: () =>
              throw TimeoutException('Bridge response timeout: $type'),
        );
  }
}
