import 'dart:math';

/// Exponential retry delay, doubling from [min] to [max], with +- [jitter].
final class Backoff {
  Backoff({
    this.min = const Duration(milliseconds: 500),
    this.max = const Duration(seconds: 10),
    this.jitter = 0.2,
    double Function()? random,
  }) : _random = random ?? Random().nextDouble,
       _base = min;

  final Duration min;
  final Duration max;
  final double jitter;
  final double Function() _random;
  Duration _base;

  Duration nextDelay() {
    final base = _base;
    final doubled = base.inMicroseconds * 2;
    _base = Duration(
      microseconds: doubled >= max.inMicroseconds
          ? max.inMicroseconds
          : doubled,
    );
    final factor = 1 + (_random() * 2 - 1) * jitter;
    return Duration(microseconds: (base.inMicroseconds * factor).round());
  }

  void reset() => _base = min;
}
