import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/screens/sessions/contract_sessions_tab.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/session_fixtures.dart';
import '../../agent/support/widget_rig.dart';

const _forked = SessionRef(backend: BackendId.pi, sessionId: 'forked');

SessionSummary _row(String id, String cwd, int at) => SessionSummary(
  session: SessionRef(backend: BackendId.pi, sessionId: id),
  title: SessionTitle(text: id, source: TitleSource.user),
  cwd: cwd,
  updatedAt: at,
  archived: false,
  status: SessionStatus.idle,
  origin: SessionOrigin.broski,
);

WidgetRig _rig(WidgetTester tester, Capabilities capabilities) {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final rig = WidgetRig(capabilities: capabilities);
  rig.bridge
    ..on<SessionsListRequest>(
      (request) => SessionsListResponse(
        requestId: request.requestId,
        result: SessionsListed(
          page: SessionPage(
            items: request.query.cwd == '/work/api'
                ? [_row('api-newest', '/work/api', 3)]
                : [
                    _row('app-1', '/work/app', 2),
                    _row('api-1', '/work/api', 1),
                  ],
          ),
        ),
      ),
    )
    ..on<SessionForkRequest>(
      (request) => SessionForkResponse(
        requestId: request.requestId,
        result: const NewSessionAccepted(session: _forked),
      ),
    );
  return rig;
}

Future<WidgetRig> _list(WidgetTester tester, Capabilities capabilities) async {
  final rig = _rig(tester, capabilities);
  addTearDown(rig.dispose);
  await rig.pump(tester, ContractSessionsTab(backend: sessionRef.backend));
  return rig;
}

AgentChatScreen _openChat(WidgetTester tester) =>
    tester.widget<AgentChatScreen>(find.byType(AgentChatScreen).last);

void main() {
  testWidgets('a row opens as a fork: the whole session, under a new id', (
    tester,
  ) async {
    final rig = await _list(tester, everything);
    await tester.tap(find.byTooltip('Actions').first);
    await tester.pumpAndSettle();
    expect(find.text('Open as fork'), findsOneWidget);
    expect(find.text('The original stays as it is'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('row-action:fork')));
    await WidgetRig.settle(tester);
    final asked = rig.sent<SessionForkRequest>();
    expect(asked.session.sessionId, 'app-1');
    expect(asked.at, isNull, reason: 'no point: the whole history');
    expect(_openChat(tester).session, _forked);
  });

  testWidgets('a backend that cannot fork offers no fork', (tester) async {
    await _list(
      tester,
      Capabilities.fromJson({...everything.toJson(), 'fork': false}),
    );
    await tester.tap(find.byTooltip('Actions').first);
    await WidgetRig.settle(tester);
    expect(find.byKey(const ValueKey('row-action:fork')), findsNothing);
  });

  testWidgets('the chat\'s More sheet opens the session as a fork', (
    tester,
  ) async {
    final rig = _rig(tester, everything);
    addTearDown(rig.dispose);
    await rig.pump(tester, const AgentChatScreen(session: sessionRef));
    await tester.tap(find.byKey(const ValueKey('chat-panels')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('chat-open-as-fork')));
    await WidgetRig.settle(tester);
    final asked = rig.sent<SessionForkRequest>();
    expect(asked.session, sessionRef);
    expect(asked.at, isNull);
    expect(_openChat(tester).session, _forked);
  });

  testWidgets('a chat whose backend cannot fork does not offer it', (
    tester,
  ) async {
    final rig = _rig(
      tester,
      Capabilities.fromJson({...everything.toJson(), 'fork': false}),
    );
    addTearDown(rig.dispose);
    await rig.pump(tester, const AgentChatScreen(session: sessionRef));
    await tester.tap(find.byKey(const ValueKey('chat-panels')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('chat-open-as-fork')), findsNothing);
  });

  testWidgets('with one directory chosen, the list continues its latest '
      'session', (tester) async {
    final rig = await _list(tester, everything);
    expect(find.byKey(const ValueKey('continue-latest')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('session-directory')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('session-directory:/work/api')).last,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('continue-latest')));
    await WidgetRig.settle(tester);
    final asked = rig.sent<SessionsListRequest>();
    expect(asked.query.cwd, '/work/api');
    expect(asked.page.limit, 1);
    expect(_openChat(tester).session.sessionId, 'api-newest');
  });

  testWidgets('a delete asks first and claims nothing it cannot know', (
    tester,
  ) async {
    await _list(tester, everything);
    await tester.tap(find.byTooltip('Actions').first);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('row-action:delete')));
    await tester.pumpAndSettle();
    expect(find.text('Its history is removed from the Mac too.'), findsOne);
    expect(find.textContaining('cannot be undone'), findsNothing);
  });
}
