import 'package:broski/agent/client/agent_clock.dart';
import 'package:flutter_test/flutter_test.dart';

/// A clock the test moves: timers fire only inside [advance], in due order.
final class ManualClock implements AgentClock {
  ManualClock([DateTime? start]) : _now = start ?? DateTime.utc(2030);

  DateTime _now;
  final List<_Timer> _timers = [];

  int get pending => _timers.length;

  @override
  DateTime now() => _now;

  @override
  void Function() after(Duration delay, void Function() action) {
    final timer = _Timer(_now.add(delay), action);
    _timers.add(timer);
    return () => _timers.remove(timer);
  }

  /// Moves time on by [by], firing every timer that falls due on the way.
  Future<void> advance(Duration by) async {
    final until = _now.add(by);
    while (true) {
      final due = _timers.where((timer) => !timer.at.isAfter(until)).toList()
        ..sort((a, b) => a.at.compareTo(b.at));
      if (due.isEmpty) break;
      final next = due.first;
      _timers.remove(next);
      _now = next.at;
      next.action();
      await pumpEventQueue();
    }
    _now = until;
  }
}

final class _Timer {
  _Timer(this.at, this.action);

  final DateTime at;
  final void Function() action;
}
