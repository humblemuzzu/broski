import 'dart:async';

/// Time as the phone core sees it: injected, so every deadline and retry in
/// tests runs on a clock the test moves.
abstract interface class AgentClock {
  DateTime now();

  /// Runs [action] once [delay] has passed; the returned function cancels it.
  void Function() after(Duration delay, void Function() action);
}

final class SystemClock implements AgentClock {
  const SystemClock();

  @override
  DateTime now() => DateTime.now();

  @override
  void Function() after(Duration delay, void Function() action) {
    final timer = Timer(delay, action);
    return timer.cancel;
  }
}
