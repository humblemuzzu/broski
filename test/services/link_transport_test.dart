import 'dart:async';
import 'dart:convert';

import 'package:broski/services/websocket/link_transport.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late StreamController<String> incoming;
  late List<String> sent;
  late WebSocketService service;

  setUp(() {
    incoming = StreamController<String>();
    sent = <String>[];
    service = WebSocketService();
  });

  tearDown(() async {
    service.dispose();
    await incoming.close();
  });

  Future<void> connect() => service.connect(
    Uri(),
    transport: LinkTransport(messages: incoming.stream, send: sent.add),
  );

  test('bridge messages reach WebSocketService consumers', () async {
    final received = <Map<String, dynamic>>[];
    service.messages.listen(received.add);
    await connect();

    incoming.add(
      jsonEncode({
        'type': 'status',
        'data': {'ok': true},
      }),
    );
    await pumpEventQueue();

    expect(received, [
      {
        'type': 'status',
        'data': {'ok': true},
      },
    ]);
  });

  test(
    'messages sent before the first consumer arrived are not lost',
    () async {
      // A link session can deliver as soon as it attaches, before the service
      // has subscribed.
      incoming.add(jsonEncode({'type': 'device_registered'}));
      await connect();
      final received = <Map<String, dynamic>>[];
      service.messages.listen(received.add);
      await pumpEventQueue();

      expect(received, [
        {'type': 'device_registered'},
      ]);
    },
  );

  test('sends go out over the link', () async {
    await connect();

    service.send({'type': 'cc_abort', 'sessionId': 's1'});

    expect(sent, [
      jsonEncode({'type': 'cc_abort', 'sessionId': 's1'}),
    ]);
  });

  test('a batched send flushes instead of waiting for a reconnect', () async {
    await connect();

    service.send({'type': 'execute_command', 'command': 'ls'});
    expect(sent, isEmpty);

    await Future<void>.delayed(const Duration(milliseconds: 80));

    expect(sent, [
      jsonEncode({'type': 'execute_command', 'command': 'ls'}),
    ]);
  });

  test('a link reports connecting until the link says otherwise', () async {
    await connect();

    expect(service.status, ConnectionStatus.connecting);

    service.applyTransportStatus(ConnectionStatus.connected);

    expect(service.status, ConnectionStatus.connected);
  });

  test('closing the transport disconnects the service', () async {
    final transport = LinkTransport(messages: incoming.stream, send: sent.add);
    await service.connect(Uri(), transport: transport);
    service.applyTransportStatus(ConnectionStatus.connected);

    await transport.close();
    await pumpEventQueue();

    expect(service.status, ConnectionStatus.disconnected);
  });
}
