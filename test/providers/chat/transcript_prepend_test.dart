import 'package:broski/models/codex.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/services/bridge_service.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

void main() {
  late FakeWebSocket socket;
  late ChatSessionNotifier chat;

  setUp(() {
    socket = FakeWebSocket();
    chat = ChatSessionNotifier(BridgeService(socket));
  });

  tearDown(() async {
    chat.dispose();
    await socket.close();
  });

  group('a page belongs to the session it was fetched for', () {
    test('a Claude Code page is dropped once another session is open', () {
      chat.setCCSession(sessionId: 'A', cwd: '/p');
      chat.setTranscriptCursor('cursor-a');
      chat.setCCSession(sessionId: 'B', cwd: '/p');

      chat.prependClaudeCodeTranscript([
        {
          'id': 'cc-old',
          'role': 'user',
          'text': 'belongs to A',
          'createdAt': 1,
        },
      ], sessionId: 'A');

      expect(chat.state.messages, isEmpty);
      expect(chat.transcriptCursor, isNull);
    });

    test('a Claude Code page lands while its own session is open', () {
      chat.setCCSession(sessionId: 'A', cwd: '/p');

      chat.prependClaudeCodeTranscript([
        {'id': 'cc-old', 'role': 'user', 'text': 'older', 'createdAt': 1},
      ], sessionId: 'A');

      expect(chat.state.messages.map((m) => m.id), ['cc-old']);
    });

    test('a Codex page is dropped once another thread is open', () {
      chat.setCodexThread(threadId: 'A', cwd: '/p');
      chat.setTranscriptCursor('cursor-a');
      chat.setCodexThread(threadId: 'B', cwd: '/p');

      chat.prependCodexTranscript([
        const CodexTranscriptMessage(
          id: 'cx-old',
          role: 'user',
          createdAt: 1,
          text: 'belongs to A',
        ),
      ], threadId: 'A');

      expect(chat.state.messages, isEmpty);
      expect(chat.transcriptCursor, isNull);
    });
  });

  group('page contents', () {
    test('a page repeating an id is prepended once', () {
      chat.setCodexThread(threadId: 't1', cwd: '/p');

      chat.prependCodexTranscript([
        const CodexTranscriptMessage(
          id: 'dup',
          role: 'user',
          createdAt: 1,
          text: 'once',
        ),
        const CodexTranscriptMessage(
          id: 'dup',
          role: 'user',
          createdAt: 1,
          text: 'once',
        ),
      ], threadId: 't1');

      expect(chat.state.messages.map((m) => m.id), ['dup']);
    });

    test('a Claude Code page repeating an id is prepended once', () {
      chat.setCCSession(sessionId: 'A', cwd: '/p');

      chat.prependClaudeCodeTranscript([
        {'id': 'dup', 'role': 'user', 'text': 'once', 'createdAt': 1},
        {'id': 'dup', 'role': 'assistant', 'text': 'once', 'createdAt': 2},
      ], sessionId: 'A');

      expect(chat.state.messages.map((m) => m.id), ['dup']);
    });
  });
}
