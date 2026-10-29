import 'package:broski/contract/generated/contract.dart';

/// One event held while an attach is out, with where it came among the
/// bridge's frames (`ContractClient.received`).
typedef HeldEvent = ({int arrival, EventEnvelope envelope});

/// What [HeldEvents.release] hands back: the events sent [before] the answer,
/// which continue the position held before it; those sent [after] it, which
/// continue the position it gives; and whether some were [lost] (not held, or
/// unreadable), in which case the session attaches again from where it is.
typedef ReleasedEvents = ({
  List<EventEnvelope> before,
  List<HeldEvent> after,
  bool lost,
});

/// The events of one session that arrive while an attach is out. Events carry
/// no epoch, so only the order the bridge sent them in says which stream an
/// event continues: what came before the attach answer continues the position
/// held before it, what came after continues the position the answer gives.
/// What follows the answer of an attach this phone no longer waits for belongs
/// to a sync it never applies, and is dropped: the newer answer covers it.
final class HeldEvents {
  /// The core's replay window (core README §6): an attach answer that waits
  /// behind more events than this is long overdue.
  static const limit = 4096;

  final List<HeldEvent> _held = [];
  int? _staleFrom;
  var _lost = false;

  void hold(int arrival, EventEnvelope envelope) {
    if (_held.length >= limit) {
      _held.clear();
      _lost = true;
    }
    _held.add((arrival: arrival, envelope: envelope));
  }

  /// An event that could not be read arrived meanwhile.
  void markLost() => _lost = true;

  /// The answer of an overtaken attach came at [arrival].
  void staleAnswer(int arrival) => _staleFrom ??= arrival;

  /// Everything held, split at the answer that came at [answer]; with no
  /// answer (the attach failed), everything came before it.
  ReleasedEvents release([int? answer]) {
    final staleFrom = _staleFrom;
    final released = (
      before: [
        for (final held in _held)
          if ((answer == null || held.arrival < answer) &&
              (staleFrom == null || held.arrival < staleFrom))
            held.envelope,
      ],
      after: [
        for (final held in _held)
          if (answer != null && held.arrival > answer) held,
      ],
      lost: _lost,
    );
    _held.clear();
    _staleFrom = null;
    _lost = false;
    return released;
  }
}
