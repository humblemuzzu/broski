import 'package:broski_link/src/connection/link_socket.dart';

/// What each socket has heard the relay say about the machine.
///
/// The engine reads a socket's presence once, when it attaches, and again on
/// every update, so a relay socket that opens before the machine is online can
/// wait instead of failing the handshake.
final class PresenceTracker {
  final Map<LinkSocket, MachinePresence> _presence =
      <LinkSocket, MachinePresence>{};

  MachinePresence? of(LinkSocket socket) => _presence[socket];

  void record(LinkSocket socket, MachinePresence presence) =>
      _presence[socket] = presence;

  void clear() => _presence.clear();
}
