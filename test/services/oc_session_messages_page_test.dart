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

  Map<String, dynamic> page(String requestId) => {
    'type': 'session_messages',
    'requestId': requestId,
    'data': [
      {
        'info': {'id': 'm8', 'role': 'user'},
        'parts': <Map<String, dynamic>>[],
      },
    ],
    'hasMore': true,
    'nextCursor': 'm3',
  };

  test(
    'asks for one page of the transcript, never the whole session',
    () async {
      final pending = bridge.pageSessionMessages(
        's1',
        projectPath: '/p',
        limit: 60,
        before: 'm9',
      );
      await pumpEventQueue();

      final sent = socket.sent.single;
      expect(sent['type'], 'get_session_messages');
      expect(sent['limit'], 60);
      expect(sent['before'], 'm9');
      expect(sent['projectPath'], '/p');

      socket.deliver(page(sent['requestId'] as String));
      final result = await pending;

      expect(result.items, hasLength(1));
      expect(result.hasMore, isTrue);
      expect(result.nextCursor, 'm3');
      expect(result.hasOlder, isTrue);
    },
  );

  test(
    'a reply too large for the link is retried with a smaller page',
    () async {
      final pending = bridge.pageSessionMessages(
        's1',
        projectPath: '/p',
        limit: 60,
      );
      await pumpEventQueue();
      final first = socket.sent.single;

      socket.deliver({
        'type': 'error',
        'code': 'response_too_large',
        'requestId': first['requestId'],
        'bytes': 9000000,
        'limit': 8388608,
        'message': 'reply of 9000000 bytes exceeds 8388608',
      });
      await pumpEventQueue();

      expect(socket.sent, hasLength(2));
      final retry = socket.sent.last;
      expect(retry['limit'], 15);
      expect(retry.containsKey('before'), isFalse);

      socket.deliver({
        'type': 'session_messages',
        'requestId': retry['requestId'],
        'data': <Map<String, dynamic>>[],
        'hasMore': false,
      });

      final result = await pending;
      expect(result.items, isEmpty);
      expect(result.hasOlder, isFalse);
    },
  );

  test('the retry stops at the smallest page instead of looping', () async {
    final pending = bridge.pageSessionMessages(
      's1',
      projectPath: '/p',
      limit: 60,
    );
    final failure = expectLater(
      pending,
      throwsA(isA<BridgeResponseTooLargeException>()),
    );
    await pumpEventQueue();

    for (var attempt = 0; attempt < 3; attempt++) {
      socket.deliver({
        'type': 'error',
        'code': 'response_too_large',
        'requestId': socket.sent.last['requestId'],
        'bytes': 9000000,
        'limit': 8388608,
        'message': 'reply of 9000000 bytes exceeds 8388608',
      });
      await pumpEventQueue();
    }

    expect(socket.sent.map((message) => message['limit']).toList(), [
      60,
      15,
      8,
    ]);
    await failure;
  });
}
