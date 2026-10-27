/// Why a link refused a message instead of sending it.
enum LinkSendFailureReason {
  /// The outbound queue is at its byte bound.
  queueFull,

  /// Larger than the queue bound, so it could never be carried.
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
    this.tag,
  });

  final LinkSendFailureReason reason;

  /// 0 is control JSON, 1 is bridge messages.
  final int stream;

  /// Bytes refused, or cleared on a [LinkSendFailureReason.sessionReset].
  final int bytes;

  /// How many messages this failure covers.
  final int count;

  /// The sender's name for the refused message, so what waits on it can fail
  /// now instead of timing out. Null when nothing does, and on a reset.
  final String? tag;

  @override
  String toString() =>
      'LinkSendFailure(${reason.name}, stream=$stream, bytes=$bytes, '
      'count=$count${tag == null ? '' : ', tag=$tag'})';
}
