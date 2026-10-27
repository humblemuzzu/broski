import 'package:broski/models/transcript_page.dart';
import 'package:broski/screens/chat/load_earlier.dart';
import 'package:broski/services/bridge/bridge_page_fetch.dart';
import 'package:broski/services/bridge/bridge_response_error.dart';
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

  test(
    'a page too large for the link is retried smaller until it fits',
    () async {
      final requested = <int>[];
      late Future<TranscriptPage<Map<String, dynamic>>> call;
      var attempt = 0;

      Future<TranscriptPage<Map<String, dynamic>>> readPage(int limit) {
        requested.add(limit);
        attempt += 1;
        call = service.readSessionMessagesPage(sessionId: 's1', limit: limit);
        final requestId = socket.lastRequestId;
        socket.deliver({
          'type': attempt < 3 ? 'error' : 'pi_session_messages',
          'requestId': requestId,
          if (attempt < 3) ...{
            'code': bridgeResponseTooLargeCode,
            'bytes': 9 * 1024 * 1024,
            'limit': 8 * 1024 * 1024,
            'message': 'Response too large for the link',
          },
          'data': [
            {'role': 'user', 'content': 'fits'},
          ],
          'hasMore': false,
        });
        return call;
      }

      final page = await fetchBridgePage(readPage, limit: kTranscriptPageLimit);

      expect(requested, [kTranscriptPageLimit, 15, 8]);
      expect(page.items.single['content'], 'fits');
      expect(page.hasOlder, isFalse);
    },
  );

  test('a bridge error reply is typed, not a plain exception', () async {
    final pending = service.readSessionMessagesPage(sessionId: 's1', limit: 8);

    socket.deliver({
      'type': 'error',
      'requestId': socket.lastRequestId,
      'code': bridgeResponseTooLargeCode,
      'bytes': 9 * 1024 * 1024,
      'limit': 8 * 1024 * 1024,
      'message': 'Response too large for the link',
    });

    await expectLater(pending, throwsA(isA<BridgeResponseTooLargeException>()));
  });
}
