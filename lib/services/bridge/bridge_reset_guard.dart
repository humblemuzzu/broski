part of '../bridge_service.dart';

/// Fails every request still waiting for a reply when the bridge loses what it
/// was asked: after a reset the answer will never come, so the caller must not
/// sit out its timeout for it.
extension BridgeServiceResetGuard on BridgeService {
  void failPendingBridgeRequests(BridgeResetReason reason) {
    if (_pendingByRequestId.isEmpty) {
      return;
    }
    final pending = _pendingByRequestId.values.toList(growable: false);
    _pendingByRequestId.clear();
    final error = BridgeResetException(reason);
    for (final completer in pending) {
      if (!completer.isCompleted) {
        completer.completeError(error);
      }
    }
  }
}
