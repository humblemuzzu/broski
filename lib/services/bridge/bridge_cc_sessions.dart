part of '../bridge_service.dart';

/// Claude Code session management methods.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceCcSessions on BridgeService {
  // ============================================================
  // Claude Code - Sessions
  // ============================================================

  Future<List<ProjectSummary>> ccListProjects() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cc_list_projects', 'requestId': requestId});
    final response = await _waitFor('cc_projects', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ProjectSummary.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<ClaudeCodeSession>> ccListSessions({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_sessions',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_sessions', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ClaudeCodeSession.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<ClaudeCodeSession?> ccGetSession(
    String sessionId, {
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    try {
      final response = await _waitFor('cc_session', requestId: requestId);
      final data = response['data'] as Map<String, dynamic>?;
      if (data == null) return null;
      return ClaudeCodeSession.fromJson(data);
    } catch (_) {
      return null;
    }
  }

  Future<List<Map<String, dynamic>>> ccGetSessionMessages(
    String sessionId, {
    String? cwd,
    int? limit,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_session_messages',
      'sessionId': sessionId,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
      if (limit != null) 'limit': limit,
    });
    final response = await _waitFor(
      'cc_session_messages',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? const [];
    return data.whereType<Map<String, dynamic>>().toList(growable: false);
  }

  /// One page of the Claude Code transcript, plus the cursor the page before it ends at.
  Future<TranscriptPage<Map<String, dynamic>>> ccGetSessionMessagesPage(
    String sessionId, {
    String? cwd,
    int? limit,
    String? before,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_session_messages',
      'sessionId': sessionId,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
      if (limit != null) 'limit': limit,
      if (before != null) 'before': before,
    });
    final response = await _waitFor(
      'cc_session_messages',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? const [];
    return TranscriptPage.fromResponse(
      response,
      data.whereType<Map<String, dynamic>>().toList(growable: false),
    );
  }

  Future<List<Map<String, dynamic>>> ccGetModifiedFiles(
    String sessionId, {
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_modified_files',
      'sessionId': sessionId,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    try {
      final response = await _waitFor(
        'cc_modified_files',
        requestId: requestId,
      );
      final data = response['data'] as List<dynamic>? ?? const [];
      return data.whereType<Map<String, dynamic>>().toList(growable: false);
    } catch (_) {
      return const [];
    }
  }

  Future<bool> ccDeleteSession(String sessionId, {String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_delete_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_session_deleted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  Future<ClaudeCodeSession?> ccForkSession(
    String sessionId, {
    String? messageId,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_fork_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (messageId != null) 'messageId': messageId,
      if (cwd != null) 'cwd': cwd,
    });
    try {
      final response = await _waitFor(
        'cc_session_forked',
        requestId: requestId,
      );
      final data = response['data'] as Map<String, dynamic>?;
      if (data == null) return null;
      return ClaudeCodeSession.fromJson(data);
    } catch (_) {
      return null;
    }
  }

  Future<ClaudeCodeSession?> ccRenameSession(
    String sessionId,
    String name, {
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_rename_session',
      'sessionId': sessionId,
      'name': name,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    try {
      final response = await _waitFor(
        'cc_session_renamed',
        requestId: requestId,
      );
      final data = response['data'] as Map<String, dynamic>?;
      if (data == null) return null;
      return ClaudeCodeSession.fromJson(data);
    } catch (_) {
      return null;
    }
  }

  Future<bool> ccBackgroundSession(String sessionId, {String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_background_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    try {
      final response = await _waitFor(
        'cc_session_backgrounded',
        requestId: requestId,
      );
      return response['data'] as bool? ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<List<Map<String, dynamic>>> ccGetActiveSessions() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cc_get_active_sessions', 'requestId': requestId});
    final response = await _waitFor('cc_active_sessions', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  /// Rewinds files to a previous checkpoint created during a Claude Code session.
  /// This undoes file changes made by Write/Edit/NotebookEdit tools.
  /// Returns true if successful, false otherwise.
  Future<bool> ccRewindCheckpoint({
    required String sessionId,
    required String checkpointUuid,
    required String cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_rewind_checkpoint',
      'sessionId': sessionId,
      'checkpointUuid': checkpointUuid,
      'cwd': cwd,
      'requestId': requestId,
    });
    try {
      final response = await _waitFor(
        'cc_checkpoint_rewound',
        requestId: requestId,
      );
      final data = response['data'];
      if (data is Map<String, dynamic>) {
        return data['success'] as bool? ?? false;
      }
      // Backward compatibility (older bridge sent top-level success)
      return response['success'] as bool? ?? false;
    } catch (_) {
      return false;
    }
  }
}
