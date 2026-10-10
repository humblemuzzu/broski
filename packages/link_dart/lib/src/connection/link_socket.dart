import 'dart:typed_data';

import 'package:broski_link/src/connection/link_status.dart';

/// What the relay last said about the machine.
enum MachinePresence { online, offline, asleep }

/// One frame off a link socket.
sealed class SocketFrame {
  const SocketFrame();
}

/// One whole link wire unit.
final class SocketBinary extends SocketFrame {
  const SocketBinary(this.bytes);

  final Uint8List bytes;
}

/// A relay status frame.
final class SocketPresence extends SocketFrame {
  const SocketPresence(this.presence, this.lastSeen);

  final MachinePresence presence;
  final DateTime? lastSeen;
}

/// One open WebSocket carrying link wire units.
abstract interface class LinkSocket {
  LinkRoute get route;
  Uri get uri;
  bool get isOpen;

  /// Attaches the handlers and starts reading. Called once, right after the
  /// socket opens, so no frame can be missed.
  void listen(
    void Function(SocketFrame frame) onFrame,
    void Function() onClosed,
  );

  void send(Uint8List bytes);

  /// A deliberate close does not report through the handler given to [listen].
  Future<void> close();
}

/// Opens one socket, or throws when it does not open within the timeout.
typedef LinkSocketDial =
    Future<LinkSocket> Function({
      required Uri uri,
      required LinkRoute route,
      required Duration timeout,
    });

extension LinkSocketDetail on LinkSocket {
  /// LAN candidates report `host:port`, the relay reports its host.
  String get detail => route == LinkRoute.lan ? uri.authority : uri.host;
}
