part of '../bridge_service.dart';

/// Codex fuzzy file search operations.
extension BridgeServiceCodexSearch on BridgeService {
  // Codex — Fuzzy File Search (@mentions)

  /// Start a fuzzy file search session.
  Future<Map<String, dynamic>> cxFuzzySearchStart({
    String? threadId,
    required String query,
    String? cwd,
    int maxResults = 20,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_fuzzy_search_start',
      'requestId': requestId,
      if (threadId != null) 'threadId': threadId,
      'query': query,
      if (cwd != null) 'cwd': cwd,
      'maxResults': maxResults,
    });
    final response = await _waitFor(
      'cx_fuzzy_search_results',
      requestId: requestId,
      timeoutSeconds: 10,
    );
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  /// Update an active fuzzy search session with a new query.
  Future<Map<String, dynamic>> cxFuzzySearchUpdate({
    required String sessionId,
    required String query,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_fuzzy_search_update',
      'requestId': requestId,
      'sessionId': sessionId,
      'query': query,
    });
    final response = await _waitFor(
      'cx_fuzzy_search_results',
      requestId: requestId,
      timeoutSeconds: 10,
    );
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  /// End a fuzzy search session.
  Future<void> cxFuzzySearchEnd({required String sessionId}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_fuzzy_search_end',
      'requestId': requestId,
      'sessionId': sessionId,
    });
    await _waitFor(
      'cx_fuzzy_search_ended',
      requestId: requestId,
      timeoutSeconds: 5,
    );
  }
}
