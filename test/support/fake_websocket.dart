import 'dart:async';

import 'package:broski/services/websocket_service.dart';

/// A [WebSocketService] whose message and status streams the test drives, so a
/// Pi request can be answered or dropped on demand without a bridge.
class FakeWebSocket extends WebSocketService {
  final _messages = StreamController<Map<String, dynamic>>.broadcast();
  final _status = StreamController<ConnectionStatus>.broadcast();

  final List<Map<String, dynamic>> sent = [];

  @override
  Stream<Map<String, dynamic>> get messages => _messages.stream;

  @override
  Stream<ConnectionStatus> get statusStream => _status.stream;

  @override
  bool send(Map<String, dynamic> message) {
    sent.add(message);
    return true;
  }

  void drop() => _status.add(ConnectionStatus.disconnected);

  void deliver(Map<String, dynamic> message) => _messages.add(message);

  String get lastRequestId => sent.last['requestId'] as String;

  Future<void> close() async {
    await _messages.close();
    await _status.close();
  }
}
