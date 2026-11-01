import 'package:broski/agent/catalog/session_actions.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/sessions/contract_sessions_tab.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

Future<WidgetRig> _list(WidgetTester tester, Capabilities capabilities) async {
  final rig = WidgetRig(capabilities: capabilities);
  addTearDown(rig.dispose);
  rig.bridge.on<SessionsListRequest>(
    (request) => SessionsListResponse(
      requestId: request.requestId,
      result: const SessionsListed(page: SessionPage(items: [summary])),
    ),
  );
  await rig.pump(tester, ContractSessionsTab(backend: sessionRef.backend));
  return rig;
}

void main() {
  testWidgets('a row offers exactly the actions the backend has', (
    tester,
  ) async {
    await _list(tester, everything);
    expect(find.byKey(const ValueKey('toggle-archived')), findsOneWidget);
    await tester.tap(find.byTooltip('Actions'));
    await WidgetRig.settle(tester);
    for (final action in ['rename', 'fork', 'archive', 'delete', 'children']) {
      expect(find.byKey(ValueKey('row-action:$action')), findsOneWidget);
    }
  });

  testWidgets('a new session starts in the directory given and opens', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final rig = await _list(tester, everything);
    rig.bridge
      ..on<ModelsListRequest>(
        (request) => ModelsListResponse(
          requestId: request.requestId,
          result: const ModelsListed(models: []),
        ),
      )
      ..on<ModesListRequest>(
        (request) => ModesListResponse(
          requestId: request.requestId,
          result: const ModesListed(modes: []),
        ),
      )
      ..on<SessionCreateRequest>(
        (request) => SessionCreateResponse(
          requestId: request.requestId,
          result: const NewSessionAccepted(session: sessionRef),
        ),
      );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('New session'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('new-session-cwd')),
      '/work',
    );
    await tester.tap(find.byTooltip('Use this directory'));
    await WidgetRig.settle(tester);
    await tester.tap(find.text('Start'));
    await WidgetRig.settle(tester);
    expect(rig.sent<SessionCreateRequest>().options.cwd, '/work');
    expect(find.byType(AgentChatScreen), findsOneWidget);
  });

  testWidgets('a row shows its run while it lasts', (tester) async {
    final rig = await _list(tester, everything);
    SessionSummary at(SessionStatus status) => SessionSummary(
      session: summary.session,
      updatedAt: 2,
      archived: false,
      status: status,
      origin: SessionOrigin.broski,
      cwd: summary.cwd,
    );
    expect(find.text('Running'), findsNothing);
    rig.bridge.catalog(
      sessionRef.backend,
      SessionUpdatedEvent(summary: at(SessionStatus.running)),
    );
    await WidgetRig.settle(tester);
    expect(find.text('Running'), findsOneWidget);
    rig.bridge.catalog(
      sessionRef.backend,
      SessionUpdatedEvent(summary: at(SessionStatus.idle)),
    );
    await WidgetRig.settle(tester);
    expect(find.text('Running'), findsNothing);
  });

  testWidgets('a rename asks for the title and sends it', (tester) async {
    final rig = await _list(tester, everything);
    rig.bridge.on<SessionRenameRequest>(
      (request) => SessionRenameResponse(
        requestId: request.requestId,
        result: const ActionAccepted(),
      ),
    );
    await tester.tap(find.byTooltip('Actions'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('row-action:rename')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Better name');
    await tester.tap(find.text('Rename').last);
    await tester.pumpAndSettle();
    expect(rig.sent<SessionRenameRequest>().title, 'Better name');
  });

  testWidgets('a backend without row actions offers none', (tester) async {
    await _list(tester, nothing);
    expect(find.byTooltip('Actions'), findsNothing);
    expect(find.byKey(const ValueKey('toggle-archived')), findsNothing);
  });

  test('an archived row offers unarchive instead of archive', () {
    final archived = SessionSummary(
      session: summary.session,
      updatedAt: 1,
      archived: true,
      status: SessionStatus.idle,
      origin: SessionOrigin.broski,
    );
    expect(rowActions(archived, everything), contains(RowAction.unarchive));
    expect(
      rowActions(archived, everything),
      isNot(contains(RowAction.archive)),
    );
  });

  test('panels follow the declared operations, each in its place', () {
    expect(
      [for (final panel in panelsAt(everything, OpPlace.session)) panel.kind],
      [BackendOpKind.changedFiles],
    );
    expect(
      [for (final panel in panelsAt(everything, OpPlace.item)) panel.kind],
      [BackendOpKind.rewindFiles],
    );
    expect(panelsAt(nothing, OpPlace.session), isEmpty);
    for (final kind in BackendOpKind.values) {
      expect(panelFor(kind).kind, kind);
    }
  });
}
