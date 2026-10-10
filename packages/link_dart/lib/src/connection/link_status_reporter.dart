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
  }) {
    _state = state;
    if (resumed != null) {
      _resumed = resumed;
    }
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
    );
    _sessionReset = false;
    if (status == _last) {
      return;
    }
    _last = status;
    _events.send(LinkIsolateStatus(status));
  }
}
