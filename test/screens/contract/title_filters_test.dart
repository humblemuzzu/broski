import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/sessions/contract_title_filters_provider.dart';
import 'package:broski/screens/sessions/contract_sessions_tab.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/widget_rig.dart';

SessionSummary _row(String id, String title) => SessionSummary(
  session: SessionRef(backend: BackendId.pi, sessionId: id),
  title: SessionTitle(text: title, source: TitleSource.user),
  cwd: '/work',
  updatedAt: 1,
  archived: false,
  status: SessionStatus.idle,
  origin: SessionOrigin.broski,
);

final _rows = [
  _row('a', 'Fix the build'),
  _row('b', 'test run 1'),
  _row('c', 'Add a login'),
];

Future<void> _tab(
  WidgetTester tester, {
  Map<String, String> stored = const {},
}) async {
  FlutterSecureStorage.setMockInitialValues({...stored});
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final rig = WidgetRig();
  addTearDown(rig.dispose);
  rig.bridge.on<SessionsListRequest>(
    (request) => SessionsListResponse(
      requestId: request.requestId,
      result: SessionsListed(page: SessionPage(items: _rows)),
    ),
  );
  await rig.pump(tester, const ContractSessionsTab(backend: BackendId.pi));
  await tester.pumpAndSettle();
}

Finder _rowOf(String id) => find.byKey(ValueKey('session-row:$id'));

Future<void> _addFilter(WidgetTester tester, String filter) async {
  await tester.tap(find.byKey(const ValueKey('title-filters')));
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byKey(const ValueKey('title-filter-input')),
    filter,
  );
  await tester.tap(find.byKey(const ValueKey('title-filter-add')));
  await tester.pumpAndSettle();
  await tester.tapAt(const Offset(10, 10));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a /regex/ filter hides the titles it matches, and is kept', (
    tester,
  ) async {
    await _tab(tester);
    expect(_rowOf('b'), findsOneWidget);

    await _addFilter(tester, '/^test/');
    expect(_rowOf('b'), findsNothing);
    expect(_rowOf('a'), findsOneWidget);
    expect(_rowOf('c'), findsOneWidget);
    expect(find.text('1 hidden by your title filters.'), findsOneWidget);
    expect(
      await const FlutterSecureStorage().read(
        key: contractTitleFiltersKey(BackendId.pi),
      ),
      '["/^test/"]',
    );
  });

  testWidgets('plain text matches anywhere in the title, whatever the case', (
    tester,
  ) async {
    await _tab(tester);
    await _addFilter(tester, 'LOGIN');
    expect(_rowOf('c'), findsNothing);
    expect(_rowOf('a'), findsOneWidget);
  });

  testWidgets('saved filters apply when the tab opens, per backend', (
    tester,
  ) async {
    await _tab(
      tester,
      stored: {
        contractTitleFiltersKey(BackendId.pi): '["build"]',
        contractTitleFiltersKey(BackendId.claudeCode): '["login"]',
      },
    );
    expect(_rowOf('a'), findsNothing);
    expect(_rowOf('c'), findsOneWidget, reason: 'another backend\'s filter');
  });

  testWidgets('removing the last filter shows every row again', (tester) async {
    await _tab(
      tester,
      stored: {contractTitleFiltersKey(BackendId.pi): '["build"]'},
    );
    await tester.tap(find.byKey(const ValueKey('title-filters')));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Remove'));
    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();
    expect(_rowOf('a'), findsOneWidget);
    expect(find.byKey(const ValueKey('session-hidden-count')), findsNothing);
  });

  test('the new Claude Code keeps its filters apart from the old one', () {
    expect(
      contractTitleFiltersKey(BackendId.claudeCode),
      isNot('broski_sessions_title_exclude_filters_claude-code'),
    );
    expect(
      contractTitleFiltersKey(BackendId.claudeCode),
      'contract_session_title_filters:claude-code',
    );
  });
}
