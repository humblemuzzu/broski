/// Why a link refused a message instead of sending it.
enum LinkSendFailureReason {
  /// The outbound queue is at its byte bound.
  queueFull,

  /// The message alone is larger than the queue bound, so it could never be
  /// carried.
  tooLarge,

  /// The session rejected this message; the ones behind it still go out.
  rejected,

  /// The session was replaced, so everything queued for the old one is gone.
  sessionReset,
}

/// One message the link did not send, reported rather than dropped in silence.
final class LinkSendFailure {
  const LinkSendFailure({
    required this.reason,
    required this.stream,
    required this.bytes,
    this.count = 1,
  });

  final LinkSendFailureReason reason;

  /// 0 is control JSON, 1 is bridge messages.
  final int stream;

  /// Bytes of the refused message, or of every message cleared on a
  /// [LinkSendFailureReason.sessionReset].
  final int bytes;

  /// How many messages this failure covers.
  final int count;

  @override
  String toString() =>
      'LinkSendFailure(${reason.name}, stream=$stream, bytes=$bytes, '
      'count=$count)';
}
