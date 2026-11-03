import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/sessions/session_list_options.dart';
import 'package:broski/screens/sessions/contract_sessions_tab.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/session_fixtures.dart';
import '../../agent/support/widget_rig.dart';

SessionSummary _row(
  String id, {
  String? title,
  String? cwd,
  String? source,
  int updatedAt = 1,
  int? createdAt,
}) => SessionSummary(
  session: SessionRef(backend: sessionRef.backend, sessionId: id),
  title: title == null
      ? null
      : SessionTitle(text: title, source: TitleSource.generated),
  cwd: cwd,
  source: source,
  updatedAt: updatedAt,
  createdAt: createdAt,
  archived: false,
  status: SessionStatus.idle,
  origin: SessionOrigin.broski,
);

List<String> _ids(List<SessionSummary> rows) => [
  for (final row in rows) row.session.sessionId,
];

final _rows = [
  _row(
    'a',
    title: 'Fix the parser',
    cwd: '/work/api',
    updatedAt: 9,
    createdAt: 1,
  ),
  _row('b', title: 'add tests', cwd: '/work/app', updatedAt: 8, createdAt: 5),
  _row('c', cwd: '/work/api', updatedAt: 7, createdAt: 3, source: 'cli'),
  _row('d', title: 'Zebra', cwd: '/work/app', updatedAt: 6),
];

void main() {
  group('what the person sees of the rows read', () {
    test('the bridge\'s own order stays unless another is chosen', () {
      expect(_ids(visibleSessions(_rows, const SessionListOptions())), [
        'a',
        'b',
        'c',
        'd',
      ]);
    });

    test('words are found in the title, directory or source, any case, '
        'all of them', () {
      List<String> find(String search) =>
          _ids(visibleSessions(_rows, SessionListOptions(search: search)));
      expect(find('PARSER'), ['a']);
      expect(find('work app'), ['b', 'd']);
      expect(find('cli'), ['c']);
      expect(find('  '), ['a', 'b', 'c', 'd']);
      expect(find('parser tests'), isEmpty);
    });

    test('ordered by when created, rows with no date last, ties in the '
        'bridge\'s order', () {
      expect(
        _ids(
          visibleSessions(
            _rows,
            const SessionListOptions(sort: SessionSort.created),
          ),
        ),
        ['b', 'c', 'a', 'd'],
      );
    });

    test('ordered by title regardless of case, untitled last', () {
      expect(
        _ids(
          visibleSessions(
            _rows,
            const SessionListOptions(sort: SessionSort.title),
          ),
        ),
        ['b', 'a', 'd', 'c'],
      );
    });

    test('one directory', () {
      expect(
        _ids(
          visibleSessions(
            _rows,
            const SessionListOptions(directory: '/work/api'),
          ),
        ),
        ['a', 'c'],
      );
    });

    test('directories come newest row first, and sections follow the rows', () {
      expect(directoriesOf(_rows), ['/work/api', '/work/app']);
      final sections = byDirectory(_rows);
      expect(
        [for (final s in sections) s.directory],
        ['/work/api', '/work/app'],
      );
      expect(_ids(sections.last.rows), ['b', 'd']);
    });
  });

  group('on the Sessions tab', () {
    Future<WidgetRig> tab(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1200, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final rig = WidgetRig(capabilities: everything);
      addTearDown(rig.dispose);
      rig.bridge.on<SessionsListRequest>(
        (request) => SessionsListResponse(
          requestId: request.requestId,
          result: SessionsListed(
            page: SessionPage(items: _rows, nextCursor: 'more'),
          ),
        ),
      );
      await rig.pump(tester, ContractSessionsTab(backend: sessionRef.backend));
      return rig;
    }

    Finder row(String id) => find.byKey(ValueKey('session-row:$id'));

    testWidgets('search narrows the rows read and says how far it looked', (
      tester,
    ) async {
      await tab(tester);
      expect(row('a'), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('session-search')),
        'zebra',
      );
      await tester.pumpAndSettle();
      expect(row('d'), findsOneWidget);
      expect(row('a'), findsNothing);
      expect(
        find.text('Looking through the 4 sessions read so far.'),
        findsOneWidget,
      );

      await tester.enterText(
        find.byKey(const ValueKey('session-search')),
        'nothing like it',
      );
      await tester.pumpAndSettle();
      expect(find.text('No session here matches.'), findsOneWidget);
    });

    testWidgets('sort, directory and grouping change what is shown', (
      tester,
    ) async {
      await tab(tester);
      await tester.tap(find.byKey(const ValueKey('session-sort')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('session-sort:title')));
      await tester.pumpAndSettle();
      expect(
        tester.getTopLeft(row('b')).dy,
        lessThan(tester.getTopLeft(row('a')).dy),
      );

      await tester.tap(find.byKey(const ValueKey('session-directory')));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('session-directory:/work/api')),
      );
      await tester.pumpAndSettle();
      expect(row('a'), findsOneWidget);
      expect(row('b'), findsNothing);

      await tester.tap(find.byKey(const ValueKey('session-directory')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('session-directory:all')));
      await tester.pumpAndSettle();
      expect(row('b'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('session-group')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('session-directory-header:/work/api')),
        findsOneWidget,
      );
      expect(find.text('api \u00b7 2'), findsOneWidget);
      expect(find.text('app \u00b7 2'), findsOneWidget);
    });
  });
}
