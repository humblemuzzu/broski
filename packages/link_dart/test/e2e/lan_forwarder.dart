import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

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
  final List<StreamSubscription<Uint8List>> _toPhone = [];
  var _open = true;
  var _paused = false;

  /// The candidate a phone dials to reach the daemon through this hop.
  String get candidate => '127.0.0.1:${_server.port}';

  /// Drops every connection and refuses the next ones: the LAN route is gone.
  void cut() {
    _open = false;
    for (final subscription in _toPhone) {
      subscription.cancel();
    }
    _toPhone.clear();
    for (final socket in List<Socket>.of(_live)) {
      socket.destroy();
    }
    _live.clear();
  }

  void restore() => _open = true;

  /// Stops handing the phone what the daemon sends, the way a phone that has
  /// stopped reading its socket would: its buffers fill, nothing is acked, and
  /// the daemon's window runs dry.
  void pause() {
    _paused = true;
    for (final subscription in _toPhone) {
      subscription.pause();
    }
  }

  void resume() {
    _paused = false;
    for (final subscription in _toPhone) {
      subscription.resume();
    }
  }

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
    StreamSubscription<Uint8List>? fromDaemon;
    var settled = false;
    void drop() {
      if (settled) {
        return;
      }
      settled = true;
      _live
        ..remove(inbound)
        ..remove(outbound);
      final subscription = fromDaemon;
      if (subscription != null) {
        _toPhone.remove(subscription);
      }
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
    fromDaemon = outbound.listen(
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
    _toPhone.add(fromDaemon);
    if (_paused) {
      fromDaemon.pause();
    }
  }
}
