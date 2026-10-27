part of '../bridge_service.dart';

/// Pages of an OpenCode transcript, and the cursor the page before one ends at.
///
/// Without a limit the bridge answers with the whole session: one frame that a
/// long chat cannot carry, which is what stalls a phone over the link.
extension BridgeServiceSessionMessagesPage on BridgeService {
  Future<TranscriptPage<Map<String, dynamic>>> getSessionMessagesPage(
    String sessionId, {
    String? projectPath,
    int? limit,
    String? before,
  }) async {
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
    final data = response['data'] as List<dynamic>? ?? const [];
    return TranscriptPage.fromResponse(
      response,
      data.whereType<Map<String, dynamic>>().toList(growable: false),
    );
  }

  /// One page, retried smaller when the bridge refuses the reply as too large.
  Future<TranscriptPage<Map<String, dynamic>>> pageSessionMessages(
    String sessionId, {
    required int limit,
    String? projectPath,
    String? before,
  }) => fetchTranscriptPage(
    (take) => getSessionMessagesPage(
      sessionId,
      projectPath: projectPath,
      limit: take,
      before: before,
    ),
    limit: limit,
  );
}
