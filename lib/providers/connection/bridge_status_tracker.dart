import 'package:broski/providers/connection/link_status_mapping.dart';
import 'package:broski/services/bridge/bridge_reset_exception.dart';
import 'package:broski_link/broski_link.dart';

/// Turns the daemon's per-session bridge status into the app-level status edges
/// the rest of the app resyncs on, and says when in-flight requests are dead.
///
/// The link publishes connecting to connected when the link itself comes up and
/// when a link session is replaced, and that edge already resyncs. So the first
/// bridge status after a link connect is adopted without another edge, and one
/// resync follows each later change of [BridgeLinkStatus.conn]: a new bridge
/// socket is the only thing that makes the bridge forget this phone's view.
///
/// [onLinkStatus] must be called after the link's own status was published, so
/// the tracker decides on the state the app has already seen.
final class BridgeStatusTracker {
  BridgeStatusTracker({
    required LinkStatusPublisher publisher,
    required this.onReset,
  }) : _publisher = publisher;

  final LinkStatusPublisher _publisher;
  final void Function(BridgeResetReason reason) onReset;

  int? _conn;
  var _linkUp = false;
  var _awaitingFirstForLink = true;
  var _bridgeReportedUp = true;

  void onLinkStatus(LinkStatus status) {
    switch (status.state) {
      case LinkConnectionState.connected:
        final linkCameUp = !_linkUp;
        _linkUp = true;
        _bridgeReportedUp = true;
        if (status.sessionReset) {
          onReset(BridgeResetReason.linkSessionReset);
        }
        if (linkCameUp || status.sessionReset) {
          _awaitingFirstForLink = true;
          _conn = null;
        }
      case LinkConnectionState.closed:
        onReset(BridgeResetReason.linkClosed);
        reset();
      case LinkConnectionState.connecting:
      case LinkConnectionState.waiting:
      case LinkConnectionState.machineOffline:
      case LinkConnectionState.machineAsleep:
        _linkUp = false;
        _awaitingFirstForLink = true;
        _conn = null;
        _bridgeReportedUp = false;
    }
  }

  void onBridgeStatus(BridgeLinkStatus status) {
    final wasReportedUp = _bridgeReportedUp;
    if (status.state == BridgeStatusState.up) {
      final previousConn = _conn;
      _conn = status.conn;
      _bridgeReportedUp = true;
      if (_awaitingFirstForLink) {
        _awaitingFirstForLink = false;
        return;
      }
      final newSocket = previousConn != null && status.conn != previousConn;
      if (newSocket || !wasReportedUp) {
        onReset(BridgeResetReason.bridgeRestarted);
        _resync();
      }
      return;
    }
    _awaitingFirstForLink = false;
    _bridgeReportedUp = false;
    if (wasReportedUp) {
      _publisher.add(const LinkStatus(state: LinkConnectionState.waiting));
    }
    onReset(BridgeResetReason.bridgeUnavailable);
  }

  void reset() {
    _linkUp = false;
    _awaitingFirstForLink = true;
    _conn = null;
    _bridgeReportedUp = false;
  }

  void _resync() => _publisher.add(
    const LinkStatus(state: LinkConnectionState.connected, sessionReset: true),
  );
}
