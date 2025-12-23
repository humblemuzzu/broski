import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

enum ConnectionStatus { disconnected, connecting, connected }

class WebSocketService {
  WebSocketChannel? _channel;
  ConnectionStatus _status = ConnectionStatus.disconnected;

  final _messageController = StreamController<Map<String, dynamic>>.broadcast();
  final _statusController = StreamController<ConnectionStatus>.broadcast();

  Stream<Map<String, dynamic>> get messages => _messageController.stream;
  Stream<ConnectionStatus> get statusStream => _statusController.stream;
  ConnectionStatus get status => _status;

  Future<void> connect(Uri uri) async {
    if (uri.toString().isEmpty) {
      throw StateError('Invalid connection URI');
    }

    // Close existing channel without triggering disconnected status
    await _channel?.sink.close();
    _channel = null;

    _setStatus(ConnectionStatus.connecting);
    _channel = WebSocketChannel.connect(uri);

    // Wait for the connection to be ready
    try {
      await _channel!.ready;
      _setStatus(ConnectionStatus.connected);
    } catch (e) {
      _channel = null;
      _setStatus(ConnectionStatus.disconnected);
      rethrow;
    }

    _channel!.stream.listen(
      (event) {
        if (event is String) {
          _handleMessage(event);
        } else if (event is List<int>) {
          _handleMessage(utf8.decode(event));
        }
      },
      onError: (_) {
        _setStatus(ConnectionStatus.disconnected);
      },
      onDone: () {
        _setStatus(ConnectionStatus.disconnected);
      },
      cancelOnError: true,
    );
  }

  void send(Map<String, dynamic> message) {
    final channel = _channel;
    if (channel == null) return;
    channel.sink.add(jsonEncode(message));
  }

  Future<void> disconnect() async {
    await _channel?.sink.close();
    _channel = null;
    _setStatus(ConnectionStatus.disconnected);
  }

  void dispose() {
    _messageController.close();
    _statusController.close();
  }

  void _handleMessage(String raw) {
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      _messageController.add(data);
    } catch (_) {
      // Ignore malformed payloads.
    }
  }

  void _setStatus(ConnectionStatus status) {
    _status = status;
    _statusController.add(status);
  }
}
