import 'package:broski/agent/catalog/session_rows.dart';
import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/screens/sessions/contract_sessions_tab.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/session_fixtures.dart';
import '../../agent/support/widget_rig.dart';

const _child = SessionRef(backend: BackendId.pi, sessionId: 's1:call-1');

const _childRow = SessionSummary(
  session: _child,
  title: SessionTitle(
    text: 'driver_subagent: Find the readme.',
    source: TitleSource.generated,
  ),
  updatedAt: 5,
  parent: SessionParent(kind: ParentKind.subagent, session: sessionRef),
  archived: false,
  status: SessionStatus.idle,
  origin: SessionOrigin.broski,
);

const _handoffRow = SessionSummary(
  session: SessionRef(backend: BackendId.pi, sessionId: 'handoff'),
  updatedAt: 6,
  parent: SessionParent(kind: ParentKind.fork, session: sessionRef),
  archived: false,
  status: SessionStatus.idle,
  origin: SessionOrigin.external,
);

void main() {
  testWidgets('the children of a session are listed under it: the subagents '
      'its tools ran and the sessions that continue it', (tester) async {
    tester.view.physicalSize = const Size(1200, 5000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    rig.bridge.on<SessionsListRequest>(
      (request) => SessionsListResponse(
        requestId: request.requestId,
        result: SessionsListed(
          page: SessionPage(
            items: request.query.parent == null
                ? const [summary]
                : [_childRow, _handoffRow],
          ),
        ),
      ),
    );
    await rig.pump(tester, ContractSessionsTab(backend: sessionRef.backend));
    await tester.tap(find.byTooltip('Actions'));
    await WidgetRig.settle(tester);
    await tester.ensureVisible(
      find.byKey(const ValueKey('row-action:children')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('row-action:children')));
    await tester.pumpAndSettle();
    expect(rig.sent<SessionsListRequest>().query.parent, sessionRef);
    expect(find.text('driver_subagent: Find the readme.'), findsOneWidget);
    expect(find.textContaining('subagent'), findsWidgets);
    expect(find.textContaining('fork'), findsWidgets);
  });

  test('a subagent row is kept out of the top-level list and in its '
      "parent's", () {
    const topLevel = SessionQuery(archived: false);
    const children = SessionQuery(archived: false, parent: sessionRef);
    expect(belongsTo(_childRow, topLevel, held: false), isFalse);
    expect(belongsTo(_childRow, children, held: false), isTrue);
    expect(belongsTo(_handoffRow, topLevel, held: false), isTrue);
    expect(belongsTo(_handoffRow, children, held: false), isTrue);
  });

  testWidgets('a tool call that ran a subagent links to its session, which '
      'opens as a conversation to watch', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final rig = WidgetRig(
      snapshot: replacing(
        emptySnapshot(),
        run: const ActiveRun(
          runId: 'r1',
          trigger: RunTrigger.prompt,
          startedAt: 1,
          items: [
            ToolCallItem(
              id: 't1',
              toolCallId: 't1',
              name: 'driver_subagent',
              childSession: _child,
            ),
          ],
          droppedItems: 0,
        ),
      ),
    );
    addTearDown(rig.dispose);
    await rig.pump(tester, const AgentChatScreen(session: sessionRef));
    await tester.tap(find.text('Open the subagent session'));
    await WidgetRig.settle(tester);
    expect(
      rig.link.sent.whereType<SessionAttachRequest>().map(
        (request) => request.session,
      ),
      contains(_child),
    );
  });
}
