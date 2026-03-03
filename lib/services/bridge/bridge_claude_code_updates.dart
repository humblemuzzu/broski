part of '../bridge_service.dart';

extension BridgeServiceClaudeCodeUpdates on BridgeService {
  /// Respond to an MCP elicitation request raised by Claude Code.
  ///
  /// `action` must be one of: accept, decline, cancel.
  /// `content` is only used for form-based elicitations.
  void ccRespondToElicitation({
    required String sessionId,
    required String requestId,
    required String action,
    Map<String, dynamic>? content,
  }) {
    _socket.send({
      'type': 'cc_elicitation_response',
      'sessionId': sessionId,
      'requestId': requestId,
      'action': action,
      if (content != null) 'content': content,
    });
  }
}
