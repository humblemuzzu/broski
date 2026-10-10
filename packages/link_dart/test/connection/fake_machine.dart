import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// A local HTTP server that plays both halves a link client can dial: the LAN
/// `/v1/link` socket and the relay's `/v1/device` socket.
///
/// It records the binary frames it receives and only ever writes relay text
/// status frames, because a real handshake needs the Rust daemon.
final class FakeMachine {
  FakeMachine._(this._server);

  static Future<FakeMachine> start() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final machine = FakeMachine._(server);
    server.listen(machine._handle);
    return machine;
  }

  final HttpServer _server;
  final List<Uint8List> lanFrames = [];
  final List<Uint8List> relayFrames = [];
  final List<Map<String, String>> relayHeaders = [];
  final Completer<void> _lanUpgrade = Completer<void>();
  final Completer<void> _relayUpgrade = Completer<void>();
  final Completer<void> _relayClosed = Completer<void>();
  final List<Completer<Uint8List>> _lanWaiters = [];
  final List<Completer<Uint8List>> _relayWaiters = [];

  /// Every `/v1/device` upgrade request, upgraded or rejected.
  var relayRequests = 0;
  var rejectRelay = false;
  WebSocket? lan;
  WebSocket? relay;

  static const List<String> _trackedHeaders = <String>[
    'x-broski-machine',
    'x-broski-device',
    'authorization',
  ];

  int get port => _server.port;
  String get candidate => '127.0.0.1:$port';
  Uri get relayUri => Uri.parse('ws://127.0.0.1:$port/v1/device');
  bool get relayOpen => relay != null && relay!.closeCode == null;

  Future<void> get lanUpgraded => _lanUpgrade.future;
  Future<void> get relayUpgraded => _relayUpgrade.future;
  Future<void> get relayClosed => _relayClosed.future;

  Future<Uint8List> nextLanFrame() => _next(_lanWaiters);

  Future<Uint8List> nextRelayFrame() => _next(_relayWaiters);

  void sendRelayStatus(String machine, {int? lastSeen}) {
    relay?.add(
      jsonEncode(<String, Object?>{
        't': 'status',
        'machine': machine,
        'last_seen': lastSeen,
      }),
    );
  }

  Future<void> close() async {
    await lan?.close();
    await relay?.close();
    await _server.close(force: true);
  }

  Future<Uint8List> _next(List<Completer<Uint8List>> waiters) {
    final completer = Completer<Uint8List>();
    waiters.add(completer);
    return completer.future.timeout(
      const Duration(seconds: 3),
      onTimeout: () => throw StateError('no frame arrived'),
    );
  }

  Future<void> _handle(HttpRequest request) async {
    final path = request.uri.path;
    if (path == '/v1/device') {
      relayRequests++;
      relayHeaders.add(_headersOf(request));
    }
    final reject =
        !WebSocketTransformer.isUpgradeRequest(request) ||
        (rejectRelay && path == '/v1/device');
    if (reject) {
      request.response.statusCode = 401;
      await request.response.close();
      return;
    }
    final socket = await WebSocketTransformer.upgrade(request);
    switch (path) {
      case '/v1/device':
        relay = socket;
        if (!_relayUpgrade.isCompleted) {
          _relayUpgrade.complete();
        }
        socket.listen(
          (Object? data) => _record(data, relayFrames, _relayWaiters),
          onError: (Object _) {},
          onDone: () {
            if (!_relayClosed.isCompleted) {
              _relayClosed.complete();
            }
          },
        );
      case '/v1/link':
        lan = socket;
        if (!_lanUpgrade.isCompleted) {
          _lanUpgrade.complete();
        }
        socket.listen(
          (Object? data) => _record(data, lanFrames, _lanWaiters),
          onError: (Object _) {},
        );
      default:
        await socket.close();
    }
  }

  Map<String, String> _headersOf(HttpRequest request) {
    final headers = <String, String>{};
    for (final name in _trackedHeaders) {
      final value = request.headers.value(name);
      if (value != null) {
        headers[name] = value;
      }
    }
    return headers;
  }

  void _record(
    Object? data,
    List<Uint8List> frames,
    List<Completer<Uint8List>> waiters,
  ) {
    if (data is! List<int>) {
      return;
    }
    final bytes = data is Uint8List ? data : Uint8List.fromList(data);
    frames.add(bytes);
    if (waiters.isNotEmpty) {
      waiters.removeAt(0).complete(bytes);
    }
  }
}
