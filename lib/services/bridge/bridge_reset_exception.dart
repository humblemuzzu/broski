/// Why in-flight bridge requests were dropped.
enum BridgeResetReason {
  /// The bridge socket was replaced, so the bridge forgot this phone's view.
  bridgeRestarted,

  /// The bridge is starting, down or crashed: nothing can answer right now.
  bridgeUnavailable,

  /// The link session was replaced.
  linkSessionReset,

  /// The link closed.
  linkClosed,
}

/// In-flight requests fail with this instead of waiting out their timeout for
/// an answer the bridge no longer has.
final class BridgeResetException implements Exception {
  const BridgeResetException(this.reason);

  final BridgeResetReason reason;

  @override
  String toString() => 'BridgeResetException(${reason.name})';
}
