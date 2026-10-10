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

  test('asks for one page and reads the cursor back', () async {
    final pending = service.readSessionMessagesPage(
      sessionPath: '/tmp/session.jsonl',
      sessionId: 's1',
      limit: 60,
      before: 'entry-9',
    );

    expect(socket.sent.single['type'], 'pi_read_session_messages');
    expect(socket.sent.single['limit'], 60);
    expect(socket.sent.single['before'], 'entry-9');
    expect(socket.sent.single['sessionPath'], '/tmp/session.jsonl');

    socket.deliver({
      'type': 'pi_session_messages',
      'requestId': socket.lastRequestId,
      'data': [
        {'role': 'user', 'content': 'earlier'},
      ],
      'hasMore': true,
      'nextCursor': 'entry-3',
    });

    final page = await pending;
    expect(page.items, [
      {'role': 'user', 'content': 'earlier'},
    ]);
    expect(page.hasMore, isTrue);
    expect(page.nextCursor, 'entry-3');
  });

  test('a reply without paging fields is the whole transcript', () async {
    final pending = service.readSessionMessagesPage(sessionId: 's1');
    expect(socket.sent.single.containsKey('limit'), isFalse);
    expect(socket.sent.single.containsKey('before'), isFalse);

    socket.deliver({
      'type': 'pi_session_messages',
      'requestId': socket.lastRequestId,
      'data': const [],
    });

    final page = await pending;
    expect(page.items, isEmpty);
    expect(page.hasOlder, isFalse);
  });
}
