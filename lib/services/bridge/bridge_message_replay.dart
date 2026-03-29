part of '../bridge_service.dart';

/// Message replay on reconnect.
///
/// After a disconnect/reconnect cycle, the client can request replay of
/// messages it missed by providing the last sequence number it received.
extension BridgeServiceMessageReplay on BridgeService {
  /// Request replay of messages missed during disconnect.
  ///
  /// Called after reconnect with the last sequence number we saw.
  /// Returns the list of missed messages to be re-processed.
  Future<List<Map<String, dynamic>>> requestMessageReplay({
    int lastSeq = 0,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_replay_request',
      'requestId': requestId,
      'lastSeq': lastSeq,
    });
    final response = await _waitFor(
      'cx_replay',
      requestId: requestId,
      timeoutSeconds: 10,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }
}
