part of '../bridge_service.dart';

/// One page at a time for every session list, the same `limit`/`before` contract the transcript
/// readers use. A page the link refuses is retried smaller instead of failing the screen.
extension BridgeSessionListsPage on BridgeService {
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
