import 'dart:async';
import 'dart:io';

/// The Bun bridge, stood in for: a real websocket on a real unix socket that
/// records the headers it was dialled with and echoes every text frame.
final class FakeBridge {
  FakeBridge._(this._server);

  static Future<FakeBridge> start(String path) async {
    final listener = await ServerSocket.bind(
      InternetAddress(path, type: InternetAddressType.unix),
      0,
    );
    final bridge = FakeBridge._(HttpServer.listenOn(listener));
    bridge._server.listen(bridge._handle);
    return bridge;
  }

  final HttpServer _server;
  final List<WebSocket> _sockets = <WebSocket>[];

  /// One entry per device session, keyed by the headers the daemon sends.
  ///
  /// The daemon's own feed connection shares the socket but is not a session,
  /// so it is never recorded.
  final List<Map<String, String>> handshakes = <Map<String, String>>[];

  /// Every text frame a device session forwarded, in order.
  final List<String> received = <String>[];

  int get connectionCount => handshakes.length;

  String? header(int index, String name) => handshakes[index][name];

  Future<void> close() async {
    for (final socket in List<WebSocket>.of(_sockets)) {
      await socket.close();
    }
    await _server.close(force: true);
  }

  Future<void> _handle(HttpRequest request) async {
    if (!WebSocketTransformer.isUpgradeRequest(request)) {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
      return;
    }
    final headers = _headers(request);
    final session = headers['x-broski-role'] == 'owner';
    if (session) {
      handshakes.add(headers);
    }
    final socket = await WebSocketTransformer.upgrade(request);
    _sockets.add(socket);
    socket.listen(
      (Object? data) {
        if (data is! String) {
          return;
        }
        if (session) {
          received.add(data);
        }
        socket.add('echo:$data');
      },
      onError: (Object _) {},
      onDone: () => _sockets.remove(socket),
    );
  }

  static const List<String> _tracked = <String>[
    'x-broski-device-id',
    'x-broski-device-name',
    'x-broski-role',
  ];

  Map<String, String> _headers(HttpRequest request) {
    final headers = <String, String>{};
    for (final name in _tracked) {
      final value = request.headers.value(name);
      if (value != null) {
        headers[name] = value;
      }
    }
    return headers;
  }
}
