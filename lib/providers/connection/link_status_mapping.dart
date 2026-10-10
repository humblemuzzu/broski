import 'package:broski/services/websocket_service.dart' show ConnectionStatus;
import 'package:broski_link/broski_link.dart';

/// Republishes a link's statuses as the statuses the rest of the app observes.
///
/// [publish] receives every app-level status, in order. [onConnected] runs once
/// per connection, and after the connecting hop of a session the machine
/// restarted, so consumers that resync on the connecting-to-connected edge run
/// exactly as they do after a WebSocket reconnect.
class LinkStatusPublisher {
  LinkStatusPublisher({required this.publish, required this.onConnected});

  final void Function(ConnectionStatus status) publish;
  final void Function() onConnected;

  void add(LinkStatus status) {
    if (status.state != LinkConnectionState.connected) {
      publish(connectionStatusFor(status.state));
      return;
    }
    if (status.sessionReset) {
      publish(ConnectionStatus.connecting);
    }
    publish(ConnectionStatus.connected);
    onConnected();
  }
}

/// The app-level status for a link that is not connected.
///
/// Everything short of [LinkConnectionState.closed] is a connection this app
/// has not lost: the link is dialling, retrying, or waiting for a machine that
/// is offline or asleep, so the app shows connecting rather than disconnected.
ConnectionStatus connectionStatusFor(LinkConnectionState state) {
  switch (state) {
    case LinkConnectionState.connected:
      return ConnectionStatus.connected;
    case LinkConnectionState.connecting:
    case LinkConnectionState.waiting:
    case LinkConnectionState.machineOffline:
    case LinkConnectionState.machineAsleep:
      return ConnectionStatus.connecting;
    case LinkConnectionState.closed:
      return ConnectionStatus.disconnected;
  }
}
