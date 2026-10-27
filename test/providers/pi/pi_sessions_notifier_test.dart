import 'package:broski/models/pi.dart';
import 'package:broski/providers/pi/pi_sessions_notifier.dart';
import 'package:broski/services/bridge/bridge_response_error.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

const int _pageLimit = 100;

Map<String, dynamic> _session(int index) => {
  'path': '/tmp/p${index % 2}/s$index.jsonl',
  'id': 's$index',
  'cwd': '/tmp/p${index % 2}',
  'created': 1700000000000 + index,
  'modified': 1700000000000 + index,
  'messageCount': 2,
  'firstMessage': 'message $index',
};

List<Map<String, dynamic>> _sessions(int from, int count) =>
    List.generate(count, (index) => _session(from + index));

Map<String, dynamic> _delta(
  int index, {
  String type = 'runtime_session_updated',
}) {
  if (type == 'runtime_session_removed') {
    return {'type': type, 'backend': 'pi', 'sessionId': 's$index'};
  }
  return {
    'type': type,
    'backend': 'pi',
    'session': {
      'id': 's$index',
      'backend': 'pi',
      'title': 'message $index',
      'cwd': '/tmp/p${index % 2}',
      'createdAtMs': 1700000000000 + index,
      'updatedAtMs': 1700000000000 + index,
      'backendData': {'path': '/tmp/p${index % 2}/s$index.jsonl'},
    },
  };
}

void main() {
  late FakeWebSocket socket;
  late PiBridgeService bridge;
  late PiSessionsNotifier notifier;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final storage = StorageService()..clearMemoryCache();
    socket = FakeWebSocket();
    bridge = PiBridgeService(socket);
    notifier = PiSessionsNotifier(
      bridge: bridge,
      storage: storage,
      deltas: socket.messages,
      isOffline: false,
      projectPath: null,
    );
  });

  tearDown(() async {
    notifier.dispose();
    bridge.dispose();
    await socket.close();
  });

  test(
    'loads one page and asks for the next one only while it has more',
    () async {
      final firstPage = notifier.load();
      expect(socket.sent.single['type'], 'pi_list_sessions');
      expect(socket.sent.single['limit'], _pageLimit);
      expect(socket.sent.single['before'], isNull);

      socket.deliver({
        'type': 'pi_sessions',
        'requestId': socket.lastRequestId,
        'data': _sessions(0, 100),
        'hasMore': true,
        'nextCursor': 'cursor-1',
      });
      await firstPage;

      expect(notifier.state.valueOrNull, hasLength(100));
      expect(notifier.hasMore, isTrue);

      final nextPage = notifier.loadMore();
      expect(socket.sent.last['before'], 'cursor-1');
      socket.deliver({
        'type': 'pi_sessions',
        'requestId': socket.lastRequestId,
        'data': _sessions(100, 50),
        'hasMore': false,
      });
      await nextPage;

      expect(notifier.state.valueOrNull, hasLength(150));
      expect(notifier.hasMore, isFalse);

      final requestsBefore = socket.sent.length;
      await notifier.loadMore();
      expect(socket.sent, hasLength(requestsBefore));
    },
  );

  test('a page the link refuses is retried with a smaller limit', () async {
    final loading = notifier.load();
    expect(socket.sent.last['limit'], _pageLimit);

    socket.deliver({
      'type': 'error',
      'code': bridgeResponseTooLargeCode,
      'requestId': socket.lastRequestId,
      'bytes': 9 * 1024 * 1024,
      'limit': 8 * 1024 * 1024,
      'message': 'Response too large for the link',
    });
    await pumpEventQueue();

    expect(socket.sent.last['limit'], _pageLimit ~/ 4);
    socket.deliver({
      'type': 'pi_sessions',
      'requestId': socket.lastRequestId,
      'data': _sessions(0, 10),
      'hasMore': false,
    });
    await loading;

    expect(notifier.state.valueOrNull, hasLength(10));
  });

  test(
    'a list that never fits ends as an error the screen can retry',
    () async {
      var settled = false;
      var answered = 0;
      final loading = notifier.load();
      loading.then(
        (_) => settled = true,
        onError: (Object _) => settled = true,
      );

      while (!settled) {
        await pumpEventQueue();
        if (socket.sent.length <= answered) continue;
        answered = socket.sent.length;
        socket.deliver({
          'type': 'error',
          'code': bridgeResponseTooLargeCode,
          'requestId': socket.lastRequestId,
          'bytes': 9 * 1024 * 1024,
          'limit': 8 * 1024 * 1024,
          'message': 'Response too large for the link',
        });
      }

      expect(answered, greaterThan(1));
      expect(notifier.state.hasError, isTrue);
      expect(notifier.state.valueOrNull, isNull);
    },
  );

  test('a delta upserts one row and a removal drops it', () async {
    final loading = notifier.load();
    socket.deliver({
      'type': 'pi_sessions',
      'requestId': socket.lastRequestId,
      'data': _sessions(0, 3),
      'hasMore': false,
    });
    await loading;

    socket.deliver(_delta(9));
    await pumpEventQueue();
    final rows = notifier.state.valueOrNull ?? const <PiSessionInfo>[];
    expect(rows.map((row) => row.id), contains('s9'));
    expect(rows.first.id, 's9');

    socket.deliver(_delta(9, type: 'runtime_session_removed'));
    await pumpEventQueue();
    expect(
      (notifier.state.valueOrNull ?? const <PiSessionInfo>[]).map((r) => r.id),
      isNot(contains('s9')),
    );
  });
}
