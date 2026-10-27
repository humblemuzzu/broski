import 'dart:collection';
import 'dart:typed_data';

import 'package:broski_link/src/connection/link_send_failure.dart';
import 'package:broski_link/src/errors.dart';

/// Bytes the outbound queue holds before it refuses a send, shared with the
/// machine's reply budget so a message that fits the queue is a message the
/// other side will answer.
///
/// It sits well inside the Rust session's own ceiling (`Config.max_unacked_bytes`
/// is 16 MiB and `max_message` 32 MiB in `packages/link/proto/src/config.rs`), so
/// a full queue is a phone problem the app is told about, never a silent drop.
const int linkOutboundQueueMax = 8 * 1024 * 1024;

/// Sessions report "not connected yet" through the message, not the code.
const List<String> _notReadyPrefixes = <String>['no session', 'not connected'];

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

  final Queue<({int stream, Uint8List bytes})> _queued =
      Queue<({int stream, Uint8List bytes})>();
  var _bytes = 0;
  var _ready = false;

  /// Whether a handshake is in flight or done. While it is false nothing can
  /// leave, so every message waits here rather than filling the session's own
  /// buffer, which a new session would drop without telling anyone.
  set ready(bool value) {
    if (_ready == value) {
      return;
    }
    _ready = value;
    pump();
  }

  int get queuedBytes => _bytes;

  int get queuedMessages => _queued.length;

  void send(int stream, Uint8List bytes) {
    if (bytes.length > linkOutboundQueueMax) {
      report(
        LinkSendFailure(
          reason: LinkSendFailureReason.tooLarge,
          stream: stream,
          bytes: bytes.length,
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
        ),
      );
      return;
    }
    _queued.add((stream: stream, bytes: bytes));
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
      } on LinkProtocolException catch (error) {
        if (_isNotReadyYet(error)) {
          return;
        }
        _dropFirst(LinkSendFailureReason.rejected);
        continue;
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

  bool _isNotReadyYet(LinkProtocolException error) =>
      _notReadyPrefixes.any((prefix) => error.message.startsWith(prefix));

  void _dropFirst(LinkSendFailureReason reason) {
    final message = _queued.first;
    report(
      LinkSendFailure(
        reason: reason,
        stream: message.stream,
        bytes: message.bytes.length,
      ),
    );
    _release();
  }

  void _release() {
    _bytes -= _queued.removeFirst().bytes.length;
  }
}
