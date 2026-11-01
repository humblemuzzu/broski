import 'package:broski/screens/system_linked/connection_stats_card.dart';
import 'package:broski/services/onboarding/linked_machine_counts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _pump(WidgetTester tester, LinkStatsView stats) =>
    tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          backgroundColor: Colors.black,
          body: ConnectionStatsCard(stats: stats),
        ),
      ),
    );

void main() {
  test('counts add up across backends and project paths are deduplicated', () {
    final counts = LinkedMachineCounts.combine(const [
      BackendRead(
        name: 'Pi',
        projectPaths: ['/repo', '/other'],
        sessions: 4,
        agents: 2,
      ),
      BackendRead(name: 'Claude Code', projectPaths: ['/repo'], sessions: 3),
      BackendRead(name: 'Pi Durable', projectPaths: ['/third'], sessions: 1),
    ]);

    expect(counts.projects, 3);
    expect(counts.sessions, 8);
    expect(counts.agents, 2);
    expect(counts.failures, isEmpty);
  });

  test('a backend that failed adds nothing and is named', () {
    final counts = LinkedMachineCounts.combine(const [
      BackendRead(name: 'Pi', projectPaths: ['/repo'], sessions: 2),
      BackendRead(name: 'Claude Code', failure: 'TimeoutException: no reply'),
    ]);

    expect(counts.projects, 1);
    expect(counts.sessions, 2);
    expect(counts.failures, ['Claude Code: TimeoutException: no reply']);
  });

  testWidgets('shows the reason a read failed instead of a zero', (
    tester,
  ) async {
    await _pump(tester, (
      latencyMs: 23,
      route: 'Local network',
      counts: LinkedMachineCounts.combine(const [
        BackendRead(
          name: 'Claude Code',
          failure: 'the bridge refused the request',
        ),
      ]),
    ));

    expect(find.text('COULD NOT READ'), findsOneWidget);
    expect(
      find.text('Claude Code: the bridge refused the request'),
      findsOneWidget,
    );
    expect(find.textContaining('PROJECTS'), findsNothing);
    expect(find.text('23ms'), findsOneWidget);
    expect(find.text('Local network'), findsOneWidget);
  });

  testWidgets('shows the counts it read, and no failure row', (tester) async {
    await _pump(tester, (
      latencyMs: null,
      route: 'Remote',
      counts: const LinkedMachineCounts(
        projects: 2,
        sessions: 9,
        agents: 1,
        failures: <String>[],
      ),
    ));

    expect(find.text('2  Detected'), findsOneWidget);
    expect(find.text('9  Detected'), findsOneWidget);
    expect(find.text('1  Detected'), findsOneWidget);
    expect(find.text('COULD NOT READ'), findsNothing);
    expect(find.text('—'), findsOneWidget, reason: 'no rtt measured yet');
  });

  testWidgets('says nothing about counts while they are still loading', (
    tester,
  ) async {
    await _pump(tester, (latencyMs: null, route: '—', counts: null));

    expect(find.text('STATUS'), findsOneWidget);
    expect(find.textContaining('Detected'), findsNothing);
    expect(find.text('COULD NOT READ'), findsNothing);
  });
}
