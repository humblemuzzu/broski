part of '../bridge_service.dart';

/// Bridge extension for listing child/subagent sessions across all backends.
extension BridgeUnifiedChildren on BridgeService {
  /// List child sessions (subagents, forks, handoffs) for a given parent session.
  /// Works across all 4 backends via the unified_list_session_children handler.
  Future<List<RuntimeSessionSummary>> listSessionChildren({
    required String backend,
    required String sessionId,
    String? cwd,
  }) async {
    final dedupeKey = 'list_session_children:$backend:$sessionId';

    if (_inFlightRequests.containsKey(dedupeKey)) {
      return await _inFlightRequests[dedupeKey] as List<RuntimeSessionSummary>;
    }

    final future = _listSessionChildrenInternal(
      backend: backend,
      sessionId: sessionId,
      cwd: cwd,
    );
    _inFlightRequests[dedupeKey] = future;

    try {
      return await future;
    } finally {
      _inFlightRequests.remove(dedupeKey);
    }
  }

  Future<List<RuntimeSessionSummary>> _listSessionChildrenInternal({
    required String backend,
    required String sessionId,
    String? cwd,
  }) async {
    return _timedRequest('list_session_children', () async {
      final requestId = _generateRequestId();
      _socket.send({
        'type': 'unified_list_session_children',
        'backend': backend,
        'sessionId': sessionId,
        'requestId': requestId,
        if (cwd != null) 'cwd': cwd,
      });
      final response = await _waitFor(
        'unified_session_children',
        requestId: requestId,
      );
      final data = response['data'] as List<dynamic>? ?? [];
      return data
          .map(
            (item) =>
                RuntimeSessionSummary.fromJson(item as Map<String, dynamic>),
          )
          .toList();
    });
  }
}
