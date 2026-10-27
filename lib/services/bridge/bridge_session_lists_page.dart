part of '../bridge_service.dart';

/// One page at a time for every session list, the same `limit`/`before` contract the transcript
/// readers use. A page the link refuses is retried smaller instead of failing the screen.
extension BridgeSessionListsPage on BridgeService {
  Future<SessionPage<SessionSummary>> listSessionsPage({
    String? projectPath,
    bool? roots,
    String? search,
    bool? archived,
    int limit = kSessionPageLimit,
    String? before,
  }) {
    return fetchBridgePage(
      (attempt) => _listSessionsPageOnce(
        projectPath: projectPath,
        roots: roots,
        search: search,
        archived: archived,
        limit: attempt,
        before: before,
      ),
      limit: limit,
    );
  }

  Future<SessionPage<SessionSummary>> _listSessionsPageOnce({
    required String? projectPath,
    required bool? roots,
    required String? search,
    required bool? archived,
    required int limit,
    required String? before,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_sessions',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (roots != null) 'roots': roots,
      if (search != null && search.isNotEmpty) 'search': search,
      if (archived != null) 'archived': archived,
      'limit': limit,
      if (before != null) 'before': before,
    });
    final response = await _waitFor('sessions', requestId: requestId);
    return SessionPage.fromResponse(
      response,
      (rows) => rows
          .map((item) => SessionSummary.fromJson(item as Map<String, dynamic>))
          .toList(),
    );
  }

  Future<SessionPage<ClaudeCodeSession>> ccListSessionsPage({
    String? cwd,
    int limit = kSessionPageLimit,
    String? before,
  }) {
    return fetchBridgePage(
      (attempt) =>
          _ccListSessionsPageOnce(cwd: cwd, limit: attempt, before: before),
      limit: limit,
    );
  }

  Future<SessionPage<ClaudeCodeSession>> _ccListSessionsPageOnce({
    required String? cwd,
    required int limit,
    required String? before,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_sessions',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
      'limit': limit,
      if (before != null) 'before': before,
    });
    final response = await _waitFor('cc_sessions', requestId: requestId);
    return SessionPage.fromResponse(
      response,
      (rows) => rows
          .map(
            (item) => ClaudeCodeSession.fromJson(item as Map<String, dynamic>),
          )
          .toList(),
    );
  }
}
