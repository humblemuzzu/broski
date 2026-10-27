import 'dart:math' as math;

/// Bounded backoff for a connect that never reached the link at all.
///
/// A link that got as far as the isolate owns its own retries; this covers only
/// the failure before that — no identity, a machine that cannot be dialled — so
/// it doubles from [initial] to [max] and stops there.
final class ConnectRetrySchedule {
  ConnectRetrySchedule({
    this.initial = const Duration(seconds: 1),
    this.max = const Duration(seconds: 30),
  }) : _next = initial;

  final Duration initial;
  final Duration max;

  Duration _next;

  /// The delay to wait before the next attempt.
  Duration next() {
    final delay = _next;
    _next = Duration(
      milliseconds: math.min(_next.inMilliseconds * 2, max.inMilliseconds),
    );
    return delay;
  }

  void reset() => _next = initial;
}
