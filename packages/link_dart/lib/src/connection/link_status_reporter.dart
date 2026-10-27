import 'dart:isolate';

import 'package:broski_link/src/connection/isolate_protocol.dart';
import 'package:broski_link/src/connection/link_status.dart';

/// Builds the status snapshots the app sees and sends the ones that changed.
final class LinkStatusReporter {
  LinkStatusReporter(this._events);

  final SendPort _events;

  var _state = LinkConnectionState.waiting;
  DateTime? _lastSeen;
  bool? _resumed;
  var _sessionReset = false;
  LinkStatus? _last;

  LinkConnectionState get state => _state;

  /// Remembers when the relay last saw the machine.
  void sawMachine(DateTime? at) {
    if (at != null) {
      _lastSeen = at;
    }
  }

  void report(
    LinkConnectionState state, {
    LinkRoute? route,
    String? routeDetail,
    bool? resumed,
    bool sessionReset = false,
    int? closeCode,
  }) {
    _state = state;
    _resumed = state == LinkConnectionState.connected
        ? resumed ?? _resumed
        : null;
    if (sessionReset) {
      _sessionReset = true;
    }
    final status = LinkStatus(
      state: state,
      route: route,
      routeDetail: routeDetail,
      lastSeen: _lastSeen,
      resumed: _resumed,
      sessionReset: _sessionReset,
      closeCode: closeCode,
    );
    _sessionReset = false;
    final previous = _last;
    _last = status;
    // Dedupe on everything but the reset flag: two resets in a row carry the
    // same route and detail, and the second one still has to reach the app.
    if (previous != null &&
        !status.sessionReset &&
        _sameSnapshot(previous, status)) {
      return;
    }
    _events.send(LinkIsolateStatus(status));
  }

  bool _sameSnapshot(LinkStatus a, LinkStatus b) =>
      a.state == b.state &&
      a.route == b.route &&
      a.routeDetail == b.routeDetail &&
      a.lastSeen == b.lastSeen &&
      a.resumed == b.resumed &&
      a.closeCode == b.closeCode;
}
