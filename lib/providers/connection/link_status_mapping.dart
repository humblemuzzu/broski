import 'package:broski/services/websocket_service.dart' show ConnectionStatus;
import 'package:broski_link/broski_link.dart';

/// Republishes a link's statuses as the statuses the rest of the app observes.
///
/// [publish] receives every app-level status change, in order. [onConnected]
/// runs once per connection, and again after the connecting hop of a session
/// the machine reset, so consumers that resync on the connecting-to-connected
/// edge run exactly as they do after a WebSocket reconnect. A status that says
/// nothing new — a second `connected`, a bridge-state change — announces
/// nothing.
class LinkStatusPublisher {
  LinkStatusPublisher({required this.publish, required this.onConnected});

  final void Function(ConnectionStatus status) publish;
  final void Function() onConnected;

  LinkConnectionState? _last;

  /// Forgets what was last published, so the next `connected` is a fresh edge.
  void reset() => _last = null;

  void add(LinkStatus status) {
    final previous = _last;
    _last = status.state;
    if (status.state != LinkConnectionState.connected) {
      publish(connectionStatusFor(status.state));
      return;
    }
    if (previous == LinkConnectionState.connected && !status.sessionReset) {
      return;
    }
    if (status.sessionReset) publish(ConnectionStatus.connecting);
    publish(ConnectionStatus.connected);
    onConnected();
  }
}

/// The app-level status for a link that is not connected.
///
/// A machine that is asleep or offline is not a connection this app is still
/// making: it is down, with a reason the link's own status carries, so the app's
/// banner and cache fallback run on `disconnected` rather than waiting on a
/// "Reconnecting" that cannot finish.
ConnectionStatus connectionStatusFor(LinkConnectionState state) {
  switch (state) {
    case LinkConnectionState.connected:
      return ConnectionStatus.connected;
    case LinkConnectionState.connecting:
    case LinkConnectionState.waiting:
      return ConnectionStatus.connecting;
    case LinkConnectionState.machineOffline:
    case LinkConnectionState.machineAsleep:
    case LinkConnectionState.closed:
      return ConnectionStatus.disconnected;
  }
}
