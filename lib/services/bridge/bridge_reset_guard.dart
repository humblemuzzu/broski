part of '../bridge_service.dart';

/// Fails every request still waiting for a reply when the bridge loses what it
/// was asked: after a reset the answer will never come, so the caller must not
/// sit out its timeout for it.
extension BridgeServiceResetGuard on BridgeService {
  void failPendingBridgeRequests(BridgeResetReason reason) =>
      _pending.failAll(BridgeResetException(reason));

  /// The link refused one request, so it never reached the bridge: only that
  /// caller loses its wait.
  void failPendingBridgeRequest(String requestId, Object error) =>
      _pending.fail(requestId, error);
}
