import 'package:broski/providers/connection/link_status_mapping.dart';
import 'package:broski/services/bridge/bridge_reset_exception.dart';
import 'package:broski_link/broski_link.dart';

/// Turns the daemon's per-session bridge status into the app-level status edges
/// the rest of the app resyncs on, and says when in-flight requests are dead.
///
/// The link's own connecting-to-connected edge already resyncs, and the daemon
/// reports its bridge state on every attach (`connecting` while its socket dials,
/// `crashed` if the bridge is down). None of that is news: the daemon queues the
/// phone's messages until its socket is ready, so a request issued then is
/// answered rather than lost. The first `up` after a link connect is adopted
/// silently, and one resync follows each later change of [BridgeLinkStatus.conn].
///
/// [onLinkStatus] must be called after the link's own status was published.
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
  var _bridgeReportedUp = false;

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
    if (status.state == BridgeStatusState.up) {
      final previousConn = _conn;
      final adopting = _awaitingFirstForLink;
      final wasReportedUp = _bridgeReportedUp;
      _conn = status.conn;
      _awaitingFirstForLink = false;
      _bridgeReportedUp = true;
      if (adopting) {
        return;
      }
      final newSocket = previousConn != null && status.conn != previousConn;
      if (newSocket || !wasReportedUp) {
        onReset(BridgeResetReason.bridgeRestarted);
        _resync();
      }
      return;
    }
    final wasReportedUp = _bridgeReportedUp;
    _bridgeReportedUp = false;
    if (_awaitingFirstForLink) {
      return;
    }
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
