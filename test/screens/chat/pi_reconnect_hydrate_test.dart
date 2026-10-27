import 'package:broski/providers/chat_provider.dart';
import 'package:broski/screens/chat/pi_reconnect_hydrate.dart';
import 'package:broski/services/bridge_service.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

void main() {
  late FakeWebSocket socket;
  late PiBridgeService piBridge;
  late ChatSessionNotifier chat;

  setUp(() {
    socket = FakeWebSocket();
    piBridge = PiBridgeService(socket);
    chat = ChatSessionNotifier(BridgeService(socket));
    chat.setPiSession(sessionId: 'pi-1', cwd: '/p');
  });

  tearDown(() async {
    piBridge.dispose();
    chat.dispose();
    await socket.close();
  });

  test('a reconnect reads one page and keeps its cursor', () async {
    final pending = hydratePiAfterReconnect(
      piBridge: piBridge,
      chat: chat,
      sessionPath: '/p/s.jsonl',
      sessionId: 'pi-1',
      projectPath: '/p',
    );

    final request = socket.sent.firstWhere(
      (message) => message['type'] == 'pi_read_session_messages',
    );
    expect(request['limit'], 60);

    socket.deliver({
      'type': 'pi_session_messages',
      'requestId': request['requestId'],
      'data': [
        {'role': 'assistant', 'text': 'recent', 'timestamp': 5},
      ],
      'hasMore': true,
      'nextCursor': 'entry-3',
    });

    expect(await pending, isTrue);
    expect(chat.transcriptCursor, 'entry-3');
    expect(chat.state.messages.map((m) => m.text), ['recent']);
  });

  test(
    'a reconnect page that has no older messages completes paging',
    () async {
      final pending = hydratePiAfterReconnect(
        piBridge: piBridge,
        chat: chat,
        sessionPath: '/p/s.jsonl',
        sessionId: 'pi-1',
        projectPath: '/p',
      );

      final request = socket.sent.firstWhere(
        (message) => message['type'] == 'pi_read_session_messages',
      );
      socket.deliver({
        'type': 'pi_session_messages',
        'requestId': request['requestId'],
        'data': [
          {'role': 'assistant', 'text': 'only', 'timestamp': 5},
        ],
      });

      expect(await pending, isFalse);
      expect(chat.transcriptCursor, isNull);
    },
  );

  test(
    'a live-instance hydrate that lands after a session change is dropped',
    () async {
      chat.setPiSession(sessionId: 'pi-1', cwd: '/p');
      final pending = startPiLiveInstance(
        piBridge: piBridge,
        chat: chat,
        sessionId: 'pi-1',
        sessionPath: '/p/s.jsonl',
        projectPath: '/p',
        loadMessages: true,
      );

      final switched = socket.sent.firstWhere(
        (message) => message['type'] == 'pi_switch_session',
      );
      socket.deliver({
        'type': 'pi_session_switched',
        'requestId': switched['requestId'],
        'data': true,
      });
      await pumpEventQueue();

      final messages = socket.sent.firstWhere(
        (message) => message['type'] == 'pi_read_session_messages',
      );
      chat.setPiSession(sessionId: 'other', cwd: '/p');
      socket.deliver({
        'type': 'pi_session_messages',
        'requestId': messages['requestId'],
        'data': [
          {'role': 'user', 'content': 'stale', 'timestamp': 1},
        ],
      });
      await pending;

      expect(chat.state.messages, isEmpty);
    },
  );

  test('a reconnect without a session file still asks for one page', () async {
    final pending = hydratePiAfterReconnect(
      piBridge: piBridge,
      chat: chat,
      sessionPath: null,
      sessionId: 'pi-1',
      projectPath: '/p',
    );

    final request = socket.sent.firstWhere(
      (message) => message['type'] == 'pi_read_session_messages',
    );
    expect(request['limit'], 60);
    expect(request['sessionPath'], isNull);
    socket.deliver({
      'type': 'pi_session_messages',
      'requestId': request['requestId'],
      'data': [
        {'role': 'user', 'content': 'page', 'timestamp': 5},
      ],
    });

    expect(await pending, isFalse);
    expect(chat.transcriptCursor, isNull);
    expect(chat.state.messages.map((m) => m.text), ['page']);
  });
}
