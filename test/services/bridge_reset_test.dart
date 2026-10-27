import 'package:broski/services/bridge/bridge_reset_exception.dart';
import 'package:broski/services/bridge/bridge_response_error.dart';
import 'package:broski/services/bridge_service.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_websocket.dart';

void main() {
  late FakeWebSocket socket;
  late BridgeService bridge;

  setUp(() {
    socket = FakeWebSocket();
    bridge = BridgeService(socket);
  });

  tearDown(() async {
    bridge.dispose();
    await socket.close();
  });

  test('a reset fails every request still waiting for a reply', () async {
    final sessions = bridge.listSessions();
    final projects = bridge.listProjects();
    await pumpEventQueue();
    expect(socket.sent, hasLength(2));

    bridge.failPendingBridgeRequests(BridgeResetReason.bridgeRestarted);

    await expectLater(sessions, throwsA(isA<BridgeResetException>()));
    await expectLater(projects, throwsA(isA<BridgeResetException>()));
  });

  test('a reset with nothing in flight is harmless', () async {
    bridge.failPendingBridgeRequests(BridgeResetReason.linkClosed);

    final sessions = bridge.listSessions();
    await pumpEventQueue();
    socket.deliver({
      'type': 'sessions',
      'requestId': socket.lastRequestId,
      'data': <Map<String, dynamic>>[],
    });

    await expectLater(sessions, completes);
  });

  test(
    'response_too_large fails the request that asked for it, and only it',
    () async {
      final big = bridge.listSessions();
      final other = bridge.listProjects();
      await pumpEventQueue();
      final bigId = socket.sent.first['requestId'] as String;
      final otherId = socket.sent.last['requestId'] as String;

      socket.deliver({
        'type': 'error',
        'code': 'response_too_large',
        'requestId': bigId,
        'bytes': 9000000,
        'limit': 8388608,
        'message': 'reply of 9000000 bytes exceeds 8388608',
      });

      await expectLater(
        big,
        throwsA(
          isA<BridgeResponseTooLargeException>()
              .having((error) => error.bytes, 'bytes', 9000000)
              .having((error) => error.limit, 'limit', 8388608),
        ),
      );

      socket.deliver({
        'type': 'projects',
        'requestId': otherId,
        'data': <Map<String, dynamic>>[],
      });

      await expectLater(other, completes);
    },
  );

  test('a plain bridge error keeps its code', () async {
    final sessions = bridge.listSessions();
    await pumpEventQueue();

    socket.deliver({
      'type': 'error',
      'requestId': socket.lastRequestId,
      'message': 'no such session',
    });

    await expectLater(
      sessions,
      throwsA(
        isA<BridgeResponseException>().having(
          (error) => error.message,
          'message',
          'no such session',
        ),
      ),
    );
  });
}
