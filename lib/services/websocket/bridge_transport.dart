import 'package:broski/services/websocket/websocket_connector.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// The raw message channel the bridge protocol runs on.
///
/// Everything above it — batching, request/response waits, isolate JSON
/// decoding — is transport agnostic, so the same [WebSocketService] runs over a
/// WebSocket or over a Broski Link session.
abstract interface class BridgeTransport {
  /// Completes once [sink] may be written to.
  Future<void> get ready;

  /// Incoming text messages, exactly as the peer sent them.
  Stream<dynamic> get stream;

  BridgeSink get sink;

  /// True when the transport owns route selection, keepalive and reconnection,
  /// so the app must not run its own over it.
  bool get managesConnection;

  Future<void> close();
}

/// The outbound half of a [BridgeTransport].
///
/// Text only: the protocol JSON-encodes every message before it reaches a sink.
abstract interface class BridgeSink {
  void add(String text);
}

/// One WebSocket, with the app owning reconnection and liveness.
final class WebSocketTransport implements BridgeTransport {
  WebSocketTransport(this._channel) : sink = _ChannelSink(_channel.sink);

  factory WebSocketTransport.connect(
    Uri uri, {
    String? authToken,
    String? pinnedCertSha256,
  }) => WebSocketTransport(
    createWebSocketChannel(
      uri,
      authToken: authToken,
      pinnedCertSha256: pinnedCertSha256,
    ),
  );

  final WebSocketChannel _channel;

  @override
  final BridgeSink sink;

  @override
  Future<void> get ready => _channel.ready;

  @override
  Stream<dynamic> get stream => _channel.stream;

  @override
  bool get managesConnection => false;

  @override
  Future<void> close() => _channel.sink.close();
}

final class _ChannelSink implements BridgeSink {
  _ChannelSink(this._sink);

  final WebSocketSink _sink;

  @override
  void add(String text) => _sink.add(text);
}
