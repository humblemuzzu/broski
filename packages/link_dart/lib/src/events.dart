import 'dart:typed_data';

sealed class LinkEvent {
  const LinkEvent();
}

/// The handshake finished. `resumed == false` means the peer started a new
/// session: everything it had not acknowledged is gone, so resync.
final class LinkConnected extends LinkEvent {
  const LinkConnected(this.resumed);

  final bool resumed;
}

final class LinkMessage extends LinkEvent {
  const LinkMessage(this.stream, this.bytes);

  final int stream;
  final Uint8List bytes;
}

final class LinkPeerClosed extends LinkEvent {
  const LinkPeerClosed(this.code);

  final int code;
}

/// The keepalive saw no traffic: drop the connection and reconnect.
final class LinkDead extends LinkEvent {
  const LinkDead();
}
