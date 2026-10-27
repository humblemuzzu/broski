import 'dart:async';

/// The replies one service is waiting for, by request id.
///
/// A reply arrives, a timeout fires, or the bridge says the answer will never
/// come — all three end one waiter here, and a reset ends every one of them
/// before the callers reach their own timeouts.
final class PendingRequests {
  final Map<String, Completer<Map<String, dynamic>>> _waiters =
      <String, Completer<Map<String, dynamic>>>{};

  bool get isEmpty => _waiters.isEmpty;

  /// The waiter for [requestId], or null when nothing waits on it yet.
  Completer<Map<String, dynamic>>? existing(String requestId) =>
      _waiters[requestId];

  /// The waiter for [requestId], adding one when nothing waits yet.
  Completer<Map<String, dynamic>> waiter(String requestId) =>
      _waiters.putIfAbsent(requestId, () => Completer<Map<String, dynamic>>());

  /// Removes and returns the waiter for [requestId], if any.
  Completer<Map<String, dynamic>>? take(String requestId) =>
      _waiters.remove(requestId);

  /// Fails the one request, for a message that will never leave the phone.
  bool fail(String requestId, Object error) {
    final waiter = _waiters.remove(requestId);
    if (waiter == null || waiter.isCompleted) {
      return false;
    }
    waiter.completeError(error);
    return true;
  }

  void failAll(Object error) {
    if (_waiters.isEmpty) {
      return;
    }
    final waiters = _waiters.values.toList(growable: false);
    _waiters.clear();
    for (final waiter in waiters) {
      if (!waiter.isCompleted) {
        waiter.completeError(error);
      }
    }
  }
}
