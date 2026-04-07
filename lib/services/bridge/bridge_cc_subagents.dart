part of '../bridge_service.dart';

/// Claude Code subagent browsing methods.
/// Supports listing subagents spawned within a CC session
/// and fetching their conversation messages.
extension BridgeServiceCcSubagents on BridgeService {
  /// List subagent IDs for a Claude Code session.
  Future<List<String>> ccListSubagents({
    required String sessionId,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_subagents',
      'sessionId': sessionId,
      if (cwd != null) 'cwd': cwd,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_subagents', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.cast<String>();
  }

  /// Get messages from a Claude Code subagent's conversation.
  Future<List<Map<String, dynamic>>> ccGetSubagentMessages({
    required String sessionId,
    required String agentId,
    String? cwd,
    int? limit,
    int? offset,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_subagent_messages',
      'sessionId': sessionId,
      'agentId': agentId,
      if (cwd != null) 'cwd': cwd,
      if (limit != null) 'limit': limit,
      if (offset != null) 'offset': offset,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_subagent_messages',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? const [];
    return data.whereType<Map<String, dynamic>>().toList(growable: false);
  }
}
