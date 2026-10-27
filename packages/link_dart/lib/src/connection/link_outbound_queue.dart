import 'dart:collection';
import 'dart:typed_data';

import 'package:broski_link/src/connection/link_send_failure.dart';
import 'package:broski_link/src/errors.dart';

/// Bytes the outbound queue holds before it refuses a send.
///
/// It is the phone's own budget, not the machine's: a message that fits here
/// still has to fit the daemon's 8 MiB per-message and 16 MiB window limits
/// (`LINK_MAX_MESSAGE_BYTES` and `BRIDGE_PENDING_BYTES` in
/// `packages/link/daemon/src/limits.rs`), and the bridge answers
/// `response_too_large` for a reply over its own cap. Staying inside the Rust
/// session's ceiling (`Config.max_unacked_bytes` and `max_message` in
/// `packages/link/proto/src/config.rs`) is all this bound promises.
const int linkOutboundQueueMax = 8 * 1024 * 1024;

/// The session's outbound messages, in order, bounded in bytes.
///
/// A message the session cannot take right now stays at the head and is retried
/// on every [pump] (an ACK frees the window), so a burst survives backpressure
/// instead of being shed. A message that can never be sent is dropped and
/// reported, so it cannot block the ones behind it.
final class LinkOutboundQueue {
  LinkOutboundQueue({required this.sendFrame, required this.report});

  final void Function(int stream, Uint8List bytes) sendFrame;
  final void Function(LinkSendFailure failure) report;

  final Queue<({int stream, Uint8List bytes, String? tag})> _queued =
      Queue<({int stream, Uint8List bytes, String? tag})>();
  var _bytes = 0;
  var _ready = false;

  /// Whether a handshake has completed, so the session can take a message.
  /// While it is false nothing can leave, so every message waits here rather
  /// than filling the session's own buffer, which a new session would drop
  /// without telling anyone.
  set ready(bool value) {
    if (_ready == value) {
      return;
    }
    _ready = value;
    pump();
  }

  int get queuedBytes => _bytes;

  int get queuedMessages => _queued.length;

  void send(int stream, Uint8List bytes, {String? tag}) {
    if (bytes.length > linkOutboundQueueMax) {
      report(
        LinkSendFailure(
          reason: LinkSendFailureReason.tooLarge,
          stream: stream,
          bytes: bytes.length,
          tag: tag,
        ),
      );
      return;
    }
    if (_bytes + bytes.length > linkOutboundQueueMax) {
      report(
        LinkSendFailure(
          reason: LinkSendFailureReason.queueFull,
          stream: stream,
          bytes: bytes.length,
          tag: tag,
        ),
      );
      return;
    }
    _queued.add((stream: stream, bytes: bytes, tag: tag));
    _bytes += bytes.length;
    pump();
  }

  /// Sends what it can from the front, stopping at the first message the
  /// session will not take yet so the order is kept.
  void pump() {
    while (_ready && _queued.isNotEmpty) {
      final message = _queued.first;
      try {
        sendFrame(message.stream, message.bytes);
      } on LinkBackpressureException {
        return;
      } on LinkNotReadyException {
        return;
      } on LinkException {
        _dropFirst(LinkSendFailureReason.rejected);
        continue;
      }
      _release();
    }
  }

  /// Forgets what was queued for a session that no longer exists, so the next
  /// one is never fed stale frames.
  void reset() {
    final count = _queued.length;
    if (count == 0) {
      return;
    }
    final bytes = _bytes;
    final stream = _queued.first.stream;
    _queued.clear();
    _bytes = 0;
    report(
      LinkSendFailure(
        reason: LinkSendFailureReason.sessionReset,
        stream: stream,
        bytes: bytes,
        count: count,
      ),
    );
  }

  void _dropFirst(LinkSendFailureReason reason) {
    final message = _queued.first;
    report(
      LinkSendFailure(
        reason: reason,
        stream: message.stream,
        bytes: message.bytes.length,
        tag: message.tag,
      ),
    );
    _release();
  }

  void _release() {
    _bytes -= _queued.removeFirst().bytes.length;
  }
}
