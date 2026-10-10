/// Which transport carries the link.
enum LinkRoute { lan, relay }

/// The state of a [LinkConnection].
///
/// [connecting] means a socket is open and a handshake is in flight;
/// [waiting] means no socket is open because a retry is scheduled, the app is
/// paused, or nothing has been tried yet. [machineOffline] and
/// [machineAsleep] come from the relay, whose socket stays open.
enum LinkConnectionState {
  connecting,
  connected,
  machineOffline,
  machineAsleep,
  waiting,
  closed,
}

/// One immutable status snapshot.
final class LinkStatus {
  const LinkStatus({
    required this.state,
    this.route,
    this.routeDetail,
    this.lastSeen,
    this.resumed,
    this.sessionReset = false,
  });

  final LinkConnectionState state;

  /// The route in use, or null while no socket is open.
  final LinkRoute? route;

  /// The LAN candidate `host:port`, or the relay host.
  final String? routeDetail;

  /// What the relay last reported for the machine.
  final DateTime? lastSeen;

  /// Whether the last handshake resumed the previous session; null before the
  /// first one finishes.
  final bool? resumed;

  /// True only on the status that reports a fresh session replacing an older
  /// one, the signal that the app must resync.
  final bool sessionReset;

  @override
  bool operator ==(Object other) =>
      other is LinkStatus &&
      other.state == state &&
      other.route == route &&
      other.routeDetail == routeDetail &&
      other.lastSeen == lastSeen &&
      other.resumed == resumed &&
      other.sessionReset == sessionReset;

  @override
  int get hashCode =>
      Object.hash(state, route, routeDetail, lastSeen, resumed, sessionReset);

  @override
  String toString() =>
      'LinkStatus($state, route=$route, detail=$routeDetail, '
      'lastSeen=$lastSeen, resumed=$resumed, sessionReset=$sessionReset)';
}
