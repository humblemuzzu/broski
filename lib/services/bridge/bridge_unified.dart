part of '../bridge_service.dart';

/// Unified bridge methods that work across all agent backends.
///
/// Phase 4: These replace per-agent bridge methods with a single method
/// per operation, parameterized by [AgentType].
extension BridgeUnified on BridgeService {
  /// List sessions/threads for any backend.
  Future<List<Map<String, dynamic>>> unifiedListSessions({
    required AgentType backend,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'unified_list_sessions',
      'backend': backend.wireValue,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('unified_sessions', requestId: requestId);
    final data = response['data'];
    if (data is List) {
      return data.cast<Map<String, dynamic>>();
    }
    return [];
  }

  /// Abort the active turn/session for any backend.
  Future<bool> unifiedAbort({
    required AgentType backend,
    String? sessionId,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'unified_abort',
      'backend': backend.wireValue,
      'requestId': requestId,
      if (sessionId != null) 'sessionId': sessionId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('unified_aborted', requestId: requestId);
    return response['data'] == true;
  }

  /// List available models for any backend.
  Future<List<Map<String, dynamic>>> unifiedListModels({
    required AgentType backend,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'unified_list_models',
      'backend': backend.wireValue,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('unified_models', requestId: requestId);
    final data = response['data'];
    if (data is List) {
      return data.cast<Map<String, dynamic>>();
    }
    return [];
  }

  /// Set the active model for any backend.
  Future<bool> unifiedSetModel({
    required AgentType backend,
    required String model,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'unified_set_model',
      'backend': backend.wireValue,
      'model': model,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('unified_model_set', requestId: requestId);
    return response['data'] == true;
  }

  /// Delete a session/thread for any backend.
  Future<bool> unifiedDeleteSession({
    required AgentType backend,
    required String sessionId,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'unified_delete_session',
      'backend': backend.wireValue,
      'sessionId': sessionId,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'unified_session_deleted',
      requestId: requestId,
    );
    return response['data'] == true;
  }

  /// List skills for any backend.
  Future<List<Map<String, dynamic>>> unifiedListSkills({
    required AgentType backend,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'unified_list_skills',
      'backend': backend.wireValue,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('unified_skills', requestId: requestId);
    final data = response['data'];
    if (data is List) {
      return data.cast<Map<String, dynamic>>();
    }
    return [];
  }

  /// List projects for any backend.
  Future<List<Map<String, dynamic>>> unifiedListProjects({
    required AgentType backend,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'unified_list_projects',
      'backend': backend.wireValue,
      'requestId': requestId,
    });
    final response = await _waitFor('unified_projects', requestId: requestId);
    final data = response['data'];
    if (data is List) {
      return data.cast<Map<String, dynamic>>();
    }
    return [];
  }
}
