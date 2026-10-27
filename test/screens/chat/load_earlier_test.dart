import 'package:broski/models/claude_code.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/session.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat/load_earlier.dart';
import 'package:broski/screens/chat/scroll_handler.dart';
import 'package:broski/screens/chat/transcript_scroll_anchor.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

ChatScreen _piChat({String id = 'pi-1'}) => ChatScreen.pi(
  piSession: PiSessionInfo(
    path: '/p/$id.jsonl',
    id: id,
    cwd: '/p',
    created: DateTime(2020),
    modified: DateTime(2020),
    messageCount: 0,
    firstMessage: '',
  ),
);

void _setPagination({required bool loadingMore, required bool loadedAll}) {}

Future<WidgetRef> _pumpHost(WidgetTester tester, FakeWebSocket socket) async {
  late WidgetRef ref;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        webSocketServiceProvider.overrideWithValue(socket),
        connectionProvider.overrideWith(
          (ref) => ConnectionNotifier(
            ref,
            ref.read(webSocketServiceProvider),
            ref.read(bridgeServiceProvider),
          ),
        ),
      ],
      child: MaterialApp(
        home: Consumer(
          builder: (context, widgetRef, _) {
            ref = widgetRef;
            return const Scaffold(body: SizedBox.shrink());
          },
        ),
      ),
    ),
  );
  await tester.pump();
  return ref;
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets('a page for a session that is no longer open is dropped', (
    tester,
  ) async {
    final socket = FakeWebSocket();
    addTearDown(socket.close);
    final ref = await _pumpHost(tester, socket);

    final chat = ref.read(chatSessionProvider.notifier);
    chat.setPiSession(sessionId: 'A', cwd: '/p');
    chat.setTranscriptCursor('cursor-a');

    final pending = loadEarlierTranscript(
      ref: ref,
      widget: _piChat(id: 'A'),
      loadingMoreMessages: false,
      hasLoadedAllMessages: false,
      scrollController: ScrollController(),
      anchorKeys: TranscriptAnchorKeys(),
      setPaginationState: _setPagination,
    );

    final request = socket.sent.firstWhere(
      (message) => message['type'] == 'pi_read_session_messages',
    );
    expect(request['before'], 'cursor-a');

    chat.setPiSession(sessionId: 'B', cwd: '/p');

    socket.deliver({
      'type': 'pi_session_messages',
      'requestId': request['requestId'],
      'data': [
        {'role': 'user', 'content': 'belongs to A', 'timestamp': 1},
      ],
      'hasMore': true,
      'nextCursor': 'cursor-a2',
    });

    await pending;

    expect(chat.state.messages, isEmpty);
    expect(chat.transcriptCursor, isNull);

    // Let the bridge request's 30s timeout timer fire so the test binding sees no pending timers.
    await tester.pump(const Duration(seconds: 31));
  });

  testWidgets('offline finishes paging instead of leaving the hint up', (
    tester,
  ) async {
    final socket = FakeWebSocket();
    addTearDown(socket.close);
    final ref = await _pumpHost(tester, socket);

    final chat = ref.read(chatSessionProvider.notifier);
    chat.setPiSession(sessionId: 'pi-1', cwd: '/p');
    chat.setTranscriptCursor('cursor-1');
    ref.read(connectionProvider.notifier).enterOfflineMode();

    final states = <({bool loadingMore, bool loadedAll})>[];
    await loadEarlierTranscript(
      ref: ref,
      widget: _piChat(),
      loadingMoreMessages: false,
      hasLoadedAllMessages: false,
      scrollController: ScrollController(),
      anchorKeys: TranscriptAnchorKeys(),
      setPaginationState:
          ({required bool loadingMore, required bool loadedAll}) {
            states.add((loadingMore: loadingMore, loadedAll: loadedAll));
          },
    );

    expect(states.last.loadedAll, isTrue);
    expect(states.last.loadingMore, isFalse);
    expect(
      socket.sent.where((m) => m['type'] == 'pi_read_session_messages'),
      isEmpty,
    );
  });

  testWidgets('pages back to the first prompt, one reply per cursor', (
    tester,
  ) async {
    final socket = FakeWebSocket();
    addTearDown(socket.close);
    final ref = await _pumpHost(tester, socket);

    final chat = ref.read(chatSessionProvider.notifier);
    chat.setPiSession(sessionId: 'pi-1', cwd: '/p');
    chat.hydratePiTranscript(const [
      {'role': 'user', 'content': 'newest prompt', 'timestamp': 3},
    ]);
    chat.setTranscriptCursor('cursor-2');

    var pagination = (loading: false, loadedAll: false);
    final pages = [
      (
        messages: const [
          {'role': 'user', 'content': 'second prompt', 'timestamp': 2},
        ],
        hasMore: true,
        cursor: 'cursor-1',
      ),
      (
        messages: const [
          {'role': 'user', 'content': 'first prompt', 'timestamp': 1},
        ],
        hasMore: false,
        cursor: null,
      ),
    ];

    for (final page in pages) {
      final loading = loadEarlierTranscript(
        ref: ref,
        widget: _piChat(),
        loadingMoreMessages: false,
        hasLoadedAllMessages: pagination.loadedAll,
        scrollController: ScrollController(),
        anchorKeys: TranscriptAnchorKeys(),
        setPaginationState:
            ({required bool loadingMore, required bool loadedAll}) {
              pagination = (loading: loadingMore, loadedAll: loadedAll);
            },
      );
      final request = socket.sent.lastWhere(
        (message) => message['type'] == 'pi_read_session_messages',
      );
      socket.deliver({
        'type': 'pi_session_messages',
        'requestId': request['requestId'],
        'data': page.messages,
        'hasMore': page.hasMore,
        if (page.cursor != null) 'nextCursor': page.cursor,
      });
      await loading;
      expect(chat.transcriptCursor, page.cursor);
    }

    expect(chat.state.messages.map((message) => message.text), [
      'first prompt',
      'second prompt',
      'newest prompt',
    ]);
    expect(pagination.loadedAll, isTrue);
    expect(pagination.loading, isFalse);
  });

  testWidgets('a page the bridge refuses leaves load earlier available', (
    tester,
  ) async {
    final socket = FakeWebSocket();
    addTearDown(socket.close);
    final ref = await _pumpHost(tester, socket);

    final chat = ref.read(chatSessionProvider.notifier);
    chat.setPiSession(sessionId: 'pi-1', cwd: '/p');
    chat.hydratePiTranscript(const [
      {'role': 'user', 'content': 'newest prompt', 'timestamp': 2},
    ]);
    chat.setTranscriptCursor('cursor-1');

    final states = <({bool loadingMore, bool loadedAll})>[];
    final loading = loadMoreMessages(
      ref: ref,
      loadingMoreMessages: false,
      hasLoadedAllMessages: false,
      projectPath: '',
      scrollController: ScrollController(),
      anchorKeys: TranscriptAnchorKeys(),
      setPaginationState:
          ({required bool loadingMore, required bool loadedAll}) {
            states.add((loadingMore: loadingMore, loadedAll: loadedAll));
          },
      isMounted: () => true,
      widget: _piChat(id: 'pi-1'),
    );
    final request = socket.sent.lastWhere(
      (message) => message['type'] == 'pi_read_session_messages',
    );
    socket.deliver({
      'type': 'error',
      'requestId': request['requestId'],
      'message': 'Session not found',
    });

    await loading;
    expect(states.last.loadingMore, isFalse);
    expect(
      states.last.loadedAll,
      isFalse,
      reason: 'a failed page must not claim the transcript is complete',
    );
    expect(chat.transcriptCursor, 'cursor-1');

    await tester.pump(const Duration(seconds: 31));
  });

  testWidgets('a page for another session is never requested', (tester) async {
    final socket = FakeWebSocket();
    addTearDown(socket.close);
    final ref = await _pumpHost(tester, socket);

    final chat = ref.read(chatSessionProvider.notifier);
    chat.setPiSession(sessionId: 'pi-2', cwd: '/p');
    chat.setTranscriptCursor('cursor-1');

    var pagination = (loading: false, loadedAll: false);
    await loadMoreMessages(
      ref: ref,
      loadingMoreMessages: false,
      hasLoadedAllMessages: false,
      projectPath: '',
      scrollController: ScrollController(),
      anchorKeys: TranscriptAnchorKeys(),
      setPaginationState:
          ({required bool loadingMore, required bool loadedAll}) {
            pagination = (loading: loadingMore, loadedAll: loadedAll);
          },
      isMounted: () => true,
      widget: _piChat(id: 'pi-1'),
    );

    expect(pagination.loadedAll, isTrue);
    expect(
      socket.sent.where((m) => m['type'] == 'pi_read_session_messages'),
      isEmpty,
      reason: 'the open transcript is pi-2, not the session this screen shows',
    );
  });

  test('the owner of a transcript is the backend its cursor came from', () {
    expect(transcriptOwnerId(_piChat(id: 'pi-7')), 'pi-7');
    expect(
      transcriptOwnerId(
        const ChatScreen.claudeCode(
          ccSession: ClaudeCodeSession(
            id: 'cc-7',
            cwd: '/p',
            createdAt: 0,
            updatedAt: 0,
          ),
        ),
      ),
      'cc-7',
    );
    expect(
      transcriptOwnerId(
        const ChatScreen(
          project: ProjectSummary(id: 'p', name: 'p', path: '/p'),
          session: SessionSummary(
            id: 'oc-7',
            title: '',
            projectID: 'p',
            directory: '/p',
            time: SessionTime(created: 0, updated: 0),
          ),
        ),
      ),
      'oc-7',
    );
  });
}
