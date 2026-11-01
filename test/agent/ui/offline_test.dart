import 'package:broski/agent/cache/agent_cache.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/sessions/session_list_screen.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/memory_text_store.dart';
import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

final _backend = BackendDescriptor(
  id: sessionRef.backend,
  capabilities: everything,
);

const _said = UserMessageItem(id: 'u1', text: 'Fix the build', attachments: []);

const _banner = ValueKey('offline-banner');

Future<WidgetRig> _screen(
  WidgetTester tester,
  AgentCache cache,
  Widget home, {
  bool reachable = true,
}) async {
  final rig = WidgetRig(cache: cache, reachable: reachable);
  addTearDown(rig.dispose);
  rig.bridge
    ..on<SessionsListRequest>(
      (request) => SessionsListResponse(
        requestId: request.requestId,
        result: const SessionsListed(page: SessionPage(items: [summary])),
      ),
    )
    ..on<TranscriptReadRequest>((request) => pageAnswer(request, [_said]));
  await tester.pumpWidget(const SizedBox());
  await rig.pump(tester, home);
  return rig;
}

void main() {
  testWidgets('with the link down the list shows what was saved, read-only', (
    tester,
  ) async {
    final cache = AgentCache(MemoryTextStore());
    final home = SessionListScreen(backend: _backend);
    await _screen(tester, cache, home);
    expect(find.byKey(const ValueKey('session-row:s1')), findsOneWidget);
    expect(find.byKey(_banner), findsNothing);

    final offline = await _screen(tester, cache, home, reachable: false);
    expect(find.byKey(const ValueKey('session-row:s1')), findsOneWidget);
    expect(find.byKey(_banner), findsOneWidget);
    expect(find.textContaining('saved'), findsOneWidget);
    expect(find.byTooltip('Actions'), findsNothing);
    expect(find.byTooltip('New session'), findsNothing);
    expect(find.byTooltip('Show archived'), findsNothing);

    offline.link.up();
    await WidgetRig.settle(tester);
    await tester.pumpAndSettle();
    expect(find.byKey(_banner), findsNothing);
    expect(find.byTooltip('Actions'), findsOneWidget);
    expect(find.byTooltip('New session'), findsOneWidget);
  });

  testWidgets('with nothing saved and the link down the list says why', (
    tester,
  ) async {
    await _screen(
      tester,
      AgentCache(MemoryTextStore()),
      SessionListScreen(backend: _backend),
      reachable: false,
    );
    expect(find.byKey(_banner), findsNothing);
    expect(find.byKey(const ValueKey('session-row:s1')), findsNothing);
  });

  testWidgets('a conversation opened before shows saved, read-only, offline', (
    tester,
  ) async {
    final cache = AgentCache(MemoryTextStore());
    const chat = AgentChatScreen(session: sessionRef);
    await _screen(tester, cache, chat);
    expect(find.text('Fix the build'), findsOneWidget);
    expect(find.byKey(_banner), findsNothing);

    final semantics = tester.ensureSemantics();
    final offline = await _screen(tester, cache, chat, reachable: false);
    expect(find.text('Fix the build'), findsOneWidget);
    expect(find.byKey(_banner), findsOneWidget);
    expect(
      tester.getSemantics(find.byKey(_banner)),
      containsSemantics(
        isLiveRegion: true,
        label:
            'Offline · read-only · '
            'saved just now',
      ),
    );
    semantics.dispose();
    expect(find.byType(TextField), findsNothing);
    expect(find.byKey(const ValueKey('agent-stop-bar')), findsNothing);

    offline.link.up();
    await WidgetRig.settle(tester);
    expect(find.text('Fix the build'), findsOneWidget);
    expect(find.byKey(_banner), findsNothing);
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('with the link up a saved conversation is not offline while '
      'the live read is under way', (tester) async {
    final cache = AgentCache(MemoryTextStore());
    const chat = AgentChatScreen(session: sessionRef);
    await _screen(tester, cache, chat);
    final rig = WidgetRig(cache: cache);
    addTearDown(rig.dispose);
    rig.bridge.on<TranscriptReadRequest>((_) => null);
    await tester.pumpWidget(const SizedBox());
    await rig.pump(tester, chat);
    expect(find.text('Fix the build'), findsOneWidget);
    expect(find.byKey(_banner), findsNothing);
    expect(find.byKey(const ValueKey('chat-settings')), findsOneWidget);
  });
}
