part of '../bridge_service.dart';

/// Codex filesystem watch operations.
extension BridgeServiceCodexFs on BridgeService {
  // Codex — Filesystem Watch

  /// Watch file paths for changes via Codex sandbox (fs/watch).
  Future<String> cxFsWatch({
    required List<String> paths,
    String? threadId,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_fs_watch',
      'requestId': requestId,
      'paths': paths,
      if (threadId != null) 'threadId': threadId,
    });
    final response = await _waitFor(
      'cx_fs_watched',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['subscriptionId'] as String? ?? '';
  }

  /// Unwatch a file subscription (fs/unwatch).
  Future<void> cxFsUnwatch({required String subscriptionId}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_fs_unwatch',
      'requestId': requestId,
      'subscriptionId': subscriptionId,
    });
    await _waitFor(
      'cx_fs_unwatched',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
  }
}
