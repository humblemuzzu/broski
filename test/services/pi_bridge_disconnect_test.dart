import 'dart:async';

import 'package:broski/models/pi.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_websocket.dart';

void main() {
  late FakeWebSocket socket;
  late PiBridgeService service;

  setUp(() {
    socket = FakeWebSocket();
    service = PiBridgeService(socket);
  });

  tearDown(() async {
    service.dispose();
    await socket.close();
  });

  test('a dropped socket fails an in-flight bash command', () async {
    final running = service.executeBash('sleep 300');
    expect(socket.sent.single['type'], 'pi_execute_bash');

    socket.drop();

    await expectLater(running, throwsA(isA<PiBridgeDisconnectedException>()));
  });

  test('a reply is still accepted while the socket is alive', () async {
    final running = service.executeBash('ls');
    final requestId = socket.lastRequestId;

    socket.deliver({
      'type': 'pi_bash_result',
      'requestId': requestId,
      'data': {'output': 'ok', 'exitCode': 0},
    });

    final PiBashResult result = await running;
    expect(result.output, 'ok');
    expect(result.exitCode, 0);
  });

  test('every in-flight request type fails on a drop, not only bash', () async {
    final state = service.getState();
    final tools = service.getTools();

    socket.drop();

    await expectLater(state, throwsA(isA<PiBridgeDisconnectedException>()));
    await expectLater(tools, throwsA(isA<PiBridgeDisconnectedException>()));
  });

  test('a request issued after the drop waits for the reconnect', () async {
    socket.drop();
    await pumpEventQueue();

    final state = service.getState();
    var failed = false;
    unawaited(state.then((_) {}, onError: (Object _) => failed = true));
    await pumpEventQueue();
    expect(failed, isFalse);

    socket.deliver({
      'type': 'pi_state',
      'requestId': socket.lastRequestId,
      'data': <String, dynamic>{},
    });

    await state;
  });
}
