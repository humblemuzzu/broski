import 'dart:async';

import 'package:broski/services/link/discovery/link_service_browser.dart';
import 'package:broski_link/broski_link.dart';

/// How long a browse has to hear nothing about the machine before the app says
/// it is offline rather than still looking for it.
const lanAbsentVerdictDelay = Duration(seconds: 8);

/// A route reported again inside this window is not a reason to dial again.
const lanRouteRedialInterval = Duration(seconds: 2);

/// How many LAN routes a machine record keeps: what is advertising now first.
const lanRouteHistoryMax = 4;

/// What a browse knows that the link status cannot say for itself.
enum LanSearchState {
  /// Nothing to add: no browse is running, or the machine is advertising and the
  /// link's own status already tells the story.
  quiet,

  /// A browse is running and has not heard from this machine yet.
  looking,

  /// Nothing for this machine has been advertised for [lanAbsentVerdictDelay].
  absent,
}

/// The clock and the timer a browse needs, so a test can run one without waiting.
abstract interface class LanSearchTiming {
  Duration now();

  /// Runs [callback] after [delay]; the returned call cancels it.
  void Function() after(Duration delay, void Function() callback);
}

/// The real clock: one stopwatch per session, and real timers.
final class LanClock implements LanSearchTiming {
  final Stopwatch _elapsed = Stopwatch()..start();

  @override
  Duration now() => _elapsed.elapsed;

  @override
  void Function() after(Duration delay, void Function() callback) =>
      Timer(delay, callback).cancel;
}

/// What a running [LanSearch] reports to.
abstract interface class LanSearchSink {
  /// Every route advertising right now, newest first.
  void routes(List<String> routes);

  void state(LanSearchState state);

  /// The browse could not run at all.
  void failed(Object error);
}

/// Whether a browse can help: only while the app is in front and the link is not
/// already carrying the machine.
///
/// A closed link is a machine this phone may no longer talk to, so it is not a
/// link waiting to be found again.
bool lanSearchWanted({required bool foreground, required LinkStatus? status}) =>
    foreground &&
    status?.state != LinkConnectionState.connected &&
    status?.state != LinkConnectionState.closed;

/// The record's LAN routes: what is advertising now, then what worked before,
/// newest first and at most [lanRouteHistoryMax] of them.
List<String> mergeLanRoutes(List<String> discovered, List<String> stored) {
  final merged = <String>[];
  for (final route in <String>[...discovered, ...stored]) {
    if (route.isEmpty || merged.contains(route)) continue;
    if (merged.length == lanRouteHistoryMax) break;
    merged.add(route);
  }
  return merged;
}

/// Keeps one browse open for [machineId] while the route in the record does not
/// answer, and reports every address the machine is advertising.
///
/// An advert is the only thing a browse reports: it never tears a link down, so
/// a machine that stops advertising while it is still reachable keeps its
/// connection.
final class LanSearch {
  LanSearch({
    required this.browser,
    required this.machineId,
    required this.sink,
    required this.timing,
    this.verdictDelay = lanAbsentVerdictDelay,
    this.redialInterval = lanRouteRedialInterval,
  });

  final LinkServiceBrowser browser;
  final String machineId;
  final LanSearchSink sink;
  final LanSearchTiming timing;
  final Duration verdictDelay;
  final Duration redialInterval;

  StreamSubscription<LinkBrowseEvent>? _subscription;
  void Function()? _cancelVerdict;
  final List<String> _live = <String>[];
  final Map<String, Duration> _pushed = <String, Duration>{};
  var _state = LanSearchState.quiet;

  LanSearchState get state => _state;

  bool get running => _subscription != null;

  void start() {
    if (_subscription != null) return;
    _live.clear();
    _set(LanSearchState.looking);
    _armVerdict();
    _subscription = browser.watch().listen(
      _onEvent,
      onError: _onError,
      cancelOnError: false,
    );
  }

  void stop() {
    final subscription = _subscription;
    _subscription = null;
    unawaited(subscription?.cancel());
    _cancelVerdict?.call();
    _cancelVerdict = null;
    _live.clear();
    _set(LanSearchState.quiet);
  }

  void _onEvent(LinkBrowseEvent event) {
    final link = event.link;
    if (link.machineId != machineId) return;
    switch (event) {
      case LinkAdvertised():
        _advertised(link.route);
      case LinkUnadvertised():
        _unadvertised(link.route);
    }
  }

  void _advertised(String route) {
    _live
      ..remove(route)
      ..insert(0, route);
    _cancelVerdict?.call();
    _cancelVerdict = null;
    _set(LanSearchState.quiet);
    final now = timing.now();
    _pushed.removeWhere((_, at) => now - at >= redialInterval);
    final last = _pushed[route];
    if (last != null && now - last < redialInterval) return;
    _pushed[route] = now;
    sink.routes(List<String>.of(_live));
  }

  void _unadvertised(String route) {
    if (!_live.remove(route)) return;
    if (_live.isNotEmpty) return;
    _set(LanSearchState.looking);
    _armVerdict();
  }

  void _armVerdict() {
    _cancelVerdict?.call();
    _cancelVerdict = timing.after(verdictDelay, () {
      _cancelVerdict = null;
      if (_live.isEmpty) _set(LanSearchState.absent);
    });
  }

  void _onError(Object error) {
    _cancelVerdict?.call();
    _cancelVerdict = null;
    _set(LanSearchState.quiet);
    sink.failed(error);
  }

  void _set(LanSearchState state) {
    if (_state == state) return;
    _state = state;
    sink.state(state);
  }
}
