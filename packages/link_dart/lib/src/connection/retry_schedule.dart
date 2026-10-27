import 'dart:async';

import 'package:broski_link/src/connection/link_status.dart';

/// The timer that brings a link back after a failed attempt.
final class RetrySchedule {
  RetrySchedule({required this.connect});

  /// Starts one attempt; [only] names the route it must take when a fallback
  /// socket was the one that failed.
  final void Function(LinkRoute? only) connect;

  Timer? _timer;

  bool get pending => _timer != null;

  void after(Duration delay, {LinkRoute? only}) {
    cancel();
    _timer = Timer(delay, () {
      _timer = null;
      connect(only);
    });
  }

  void cancel() {
    _timer?.cancel();
    _timer = null;
  }
}
