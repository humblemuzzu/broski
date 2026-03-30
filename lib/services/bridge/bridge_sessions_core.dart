part of '../bridge_service.dart';

/// Session CRUD operations and lifecycle management.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceSessionsCore on BridgeService {
  // ============================================================
  // Projects
  // ============================================================

  Future<List<ProjectSummary>> listProjects() async {
    const dedupeKey = 'list_projects';

    if (_inFlightRequests.containsKey(dedupeKey)) {
      return await _inFlightRequests[dedupeKey] as List<ProjectSummary>;
    }

    final future = _listProjectsInternal();
    _inFlightRequests[dedupeKey] = future;

    try {
      return await future;
    } finally {
      _inFlightRequests.remove(dedupeKey);
    }
  }

  Future<List<ProjectSummary>> _listProjectsInternal() async {
    return _timedRequest('list_projects', () async {
      final requestId = _generateRequestId();
      _socket.send({'type': 'list_projects', 'requestId': requestId});
      final response = await _waitFor('projects', requestId: requestId);
      final data = response['data'] as List<dynamic>? ?? [];
      return data
          .map((item) => ProjectSummary.fromJson(item as Map<String, dynamic>))
          .toList();
    });
  }

  // ============================================================
  // Sessions
  // ============================================================

  Future<List<SessionSummary>> listSessions({
    String? projectPath,
    bool? roots,
    int? start,
    int? cursor,
    String? search,
    int? limit,
    bool? archived,
  }) => _bridgeListSessions(
    this,
    projectPath: projectPath,
    roots: roots,
    start: start,
    cursor: cursor,
    search: search,
    limit: limit,
    archived: archived,
  );

  Future<List<SessionSummary>> _listSessionsInternal({
    String? projectPath,
    bool? roots,
    int? start,
    int? cursor,
    String? search,
    int? limit,
    bool? archived,
  }) => _bridgeListSessionsInternal(
    this,
    projectPath: projectPath,
    roots: roots,
    start: start,
    cursor: cursor,
    search: search,
    limit: limit,
    archived: archived,
  );

  /// Create a new session (protected against duplicate calls)
  Future<SessionSummary> createSession({
    String? projectPath,
    String? title,
    PermissionRuleset? permission,
    String? workspaceID,
  }) {
    final permKey = permission == null
        ? 'none'
        : permission
              .map((r) => '${r.permission}:${r.pattern}:${r.action.name}')
              .join('|');
    final dedupeKey = 'create_session:${projectPath ?? 'global'}:$permKey';
    return _deduplicatedRequest(
      dedupeKey,
      () => _createSessionInternal(
        projectPath: projectPath,
        title: title,
        permission: permission,
        workspaceID: workspaceID,
      ),
    );
  }

  Future<SessionSummary> _createSessionInternal({
    String? projectPath,
    String? title,
    PermissionRuleset? permission,
    String? workspaceID,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'create_session',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (title != null) 'title': title,
      if (permission != null)
        'permission': permission.map((r) => r.toJson()).toList(),
      if (workspaceID != null) 'workspaceID': workspaceID,
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
    String? before,
  }) async {
    final dedupeKey =
        'get_session_messages:$sessionId:${projectPath ?? 'null'}:${limit ?? 'all'}:${before ?? 'none'}';

    if (_inFlightRequests.containsKey(dedupeKey)) {
      return await _inFlightRequests[dedupeKey] as List<dynamic>;
    }

    final future = _getSessionMessagesInternal(
      sessionId,
      projectPath: projectPath,
      limit: limit,
      before: before,
    );
    _inFlightRequests[dedupeKey] = future;

    try {
      return await future;
    } finally {
      _inFlightRequests.remove(dedupeKey);
    }
  }

  Future<List<dynamic>> _getSessionMessagesInternal(
    String sessionId, {
    String? projectPath,
    int? limit,
    String? before,
  }) async {
    return _timedRequest('get_session_messages', () async {
      final requestId = _generateRequestId();
      _socket.send({
        'type': 'get_session_messages',
        'sessionId': sessionId,
        'requestId': requestId,
        if (projectPath != null) 'projectPath': projectPath,
        if (limit != null) 'limit': limit,
        if (before != null) 'before': before,
      });
      final response = await _waitFor('session_messages', requestId: requestId);
      return response['data'] as List<dynamic>? ?? [];
    });
  }

  /// Delete a session (protected against duplicate deletions)
  Future<bool> deleteSession(String sessionId, {String? projectPath}) {
    final dedupeKey = 'delete_session:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _deleteSessionInternal(sessionId, projectPath: projectPath),
    );
  }

  Future<bool> _deleteSessionInternal(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'delete_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_deleted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  /// Update session (rename title, archive)
  Future<SessionSummary> updateSession(
    String sessionId, {
    String? title,
    bool? archived,
    String? projectPath,
  }) {
    final dedupeKey = 'update_session:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _updateSessionInternal(
        sessionId,
        title: title,
        archived: archived,
        projectPath: projectPath,
      ),
    );
  }

  Future<SessionSummary> _updateSessionInternal(
    String sessionId, {
    String? title,
    bool? archived,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'update_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (title != null) 'title': title,
      if (archived != null) 'archived': archived,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_updated', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  /// Get status of all sessions (idle/busy/retry)
  Future<Map<String, SessionStatus>> getSessionStatus({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_session_status',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_status', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    final result = <String, SessionStatus>{};
    for (final entry in data.entries) {
      result[entry.key] = SessionStatus.fromJson(
        entry.value as Map<String, dynamic>,
      );
    }
    return result;
  }

  /// List available agents (build, plan, etc.)
  Future<List<Agent>> listAgents({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_agents',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('agents', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => Agent.fromJson(item as Map<String, dynamic>))
        .toList();
  }
}
