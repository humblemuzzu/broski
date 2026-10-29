import 'dart:async';

import 'package:broski/agent/client/agent_clock.dart';

/// Waits the client takes between retries. Closing ends every wait at once,
/// so no retry loop is left suspended on a timer that will never fire.
final class ClientDelays {
  ClientDelays(this._clock);

  final AgentClock _clock;
  final Map<Completer<void>, void Function()> _waiting = {};

  Future<void> wait(Duration delay) {
    final done = Completer<void>();
    _waiting[done] = _clock.after(delay, () {
      if (_waiting.remove(done) != null) done.complete();
    });
    return done.future;
  }

  void close() {
    for (final MapEntry(key: done, value: cancel) in _waiting.entries) {
      cancel();
      done.complete();
    }
    _waiting.clear();
  }
}
