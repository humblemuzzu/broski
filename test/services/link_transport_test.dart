import 'dart:async';
import 'dart:convert';

import 'package:broski/services/websocket/link_transport.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late StreamController<String> incoming;
  late List<String> sent;
  late List<String?> tags;
  late WebSocketService service;

  setUp(() {
    incoming = StreamController<String>();
    sent = <String>[];
    tags = <String?>[];
    service = WebSocketService();
  });

  void send(String text, {String? tag}) {
    sent.add(text);
    tags.add(tag);
  }

  tearDown(() async {
    service.dispose();
    await incoming.close();
  });

  Future<void> connect() =>
      service.connect(LinkTransport(messages: incoming.stream, send: send));

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

  test('a request carries its id so a refused send can fail it', () async {
    await connect();

    service.send({'type': 'cc_abort', 'sessionId': 's1', 'requestId': 'req_3'});
    service.send({'type': 'cc_abort', 'sessionId': 's2'});

    expect(tags, ['req_3', null]);
  });

  test('sends made before a link attaches go out once it does', () async {
    service.send({'type': 'cc_abort', 'sessionId': 's1'});
    expect(sent, isEmpty);

    await connect();

    expect(sent, [
      jsonEncode({'type': 'cc_abort', 'sessionId': 's1'}),
    ]);
  });

  test('a batched send flushes instead of waiting for a reconnect', () async {
    await connect();

    service.send({'type': 'execute_command', 'command': 'ls'});
    expect(sent, isEmpty);

    await _until(() => sent.isNotEmpty);

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
    final transport = LinkTransport(messages: incoming.stream, send: send);
    await service.connect(transport);
    service.applyTransportStatus(ConnectionStatus.connected);

    await transport.close();
    await pumpEventQueue();

    expect(service.status, ConnectionStatus.disconnected);
  });
}

/// Waits for [ready] instead of for a duration, so a slow machine cannot make
/// the test pass or fail on its own timing.
Future<void> _until(bool Function() ready) async {
  final deadline = DateTime.now().add(const Duration(seconds: 5));
  while (!ready()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('the condition never became true');
    }
    await pumpEventQueue();
  }
}
