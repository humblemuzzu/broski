/// The outcome of a race between the relay socket and the LAN candidates.
enum RouteChoice { wait, lan, relay }

/// Picks between a relay socket and LAN candidates that open concurrently.
///
/// LAN always wins when it opens while the relay is still inside its grace
/// window, whatever the order they opened in. Time is only ever signalled by
/// [graceElapsed], so the whole class is a pure function of the events fed in.
final class RouteRace {
  RouteRace({required this.lanCandidates}) : assert(lanCandidates >= 0);

  final int lanCandidates;
  var _lanFailures = 0;
  var _relayOpen = false;
  var _gracePending = false;
  var _choice = RouteChoice.wait;
  int? _winner;

  RouteChoice get choice => _choice;

  /// Index of the LAN candidate that won, when [choice] is [RouteChoice.lan].
  int? get lanIndex => _winner;

  /// True while a LAN socket may still open and beat the open relay.
  bool get awaitingGrace =>
      _choice == RouteChoice.wait && _gracePending && _lanPossible;

  bool get _lanPossible => _winner == null && _lanFailures < lanCandidates;

  void lanOpened(int index) {
    if (_choice != RouteChoice.wait || _winner != null) {
      return;
    }
    _winner = index;
    _resolve();
  }

  void lanFailed() {
    _lanFailures++;
    _resolve();
  }

  void relayOpened() {
    if (_relayOpen) {
      return;
    }
    _relayOpen = true;
    _gracePending = true;
    _resolve();
  }

  void relayFailed() {
    _relayOpen = false;
    _gracePending = false;
    _resolve();
  }

  /// The grace window for a LAN socket to beat the relay has passed.
  void graceElapsed() {
    if (!_gracePending) {
      return;
    }
    _gracePending = false;
    _resolve();
  }

  void _resolve() {
    if (_choice != RouteChoice.wait) {
      return;
    }
    if (_winner != null) {
      _choice = RouteChoice.lan;
      return;
    }
    if (_relayOpen && !(_lanPossible && _gracePending)) {
      _choice = RouteChoice.relay;
    }
  }
}
