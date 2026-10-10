import 'dart:async';
import 'dart:io';

/// A loopback TCP hop in front of the daemon's LAN port, so a test can take the
/// LAN route away and give it back without touching the daemon.
final class LanForwarder {
  LanForwarder._(this._server, this._target);

  static Future<LanForwarder> start(int targetPort) async {
    final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final forwarder = LanForwarder._(server, targetPort);
    server.listen(forwarder._accept);
    return forwarder;
  }

  final ServerSocket _server;
  final int _target;
  final List<Socket> _live = <Socket>[];
  var _open = true;

  /// The candidate a phone dials to reach the daemon through this hop.
  String get candidate => '127.0.0.1:${_server.port}';

  /// Drops every connection and refuses the next ones: the LAN route is gone.
  void cut() {
    _open = false;
    for (final socket in List<Socket>.of(_live)) {
      socket.destroy();
    }
    _live.clear();
  }

  void restore() => _open = true;

  Future<void> close() async {
    cut();
    await _server.close();
  }

  Future<void> _accept(Socket inbound) async {
    if (!_open) {
      inbound.destroy();
      return;
    }
    final Socket outbound;
    try {
      outbound = await Socket.connect(InternetAddress.loopbackIPv4, _target);
    } on Object {
      inbound.destroy();
      return;
    }
    _live
      ..add(inbound)
      ..add(outbound);
    var settled = false;
    void drop() {
      if (settled) {
        return;
      }
      settled = true;
      _live
        ..remove(inbound)
        ..remove(outbound);
    }

    inbound.listen(
      outbound.add,
      onError: (Object _) {
        outbound.destroy();
        drop();
      },
      onDone: () {
        outbound.destroy();
        drop();
      },
    );
    outbound.listen(
      inbound.add,
      onError: (Object _) {
        inbound.destroy();
        drop();
      },
      onDone: () {
        inbound.destroy();
        drop();
      },
    );
  }
}
