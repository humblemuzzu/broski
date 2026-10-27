import 'package:broski_link/broski_link.dart';

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

/// The link never carried the request, so no answer is coming and the caller
/// must not sit out its timeout waiting for one.
final class BridgeSendRefusedException implements Exception {
  const BridgeSendRefusedException(this.reason);

  final LinkSendFailureReason reason;

  @override
  String toString() => 'BridgeSendRefusedException(${reason.name})';
}
