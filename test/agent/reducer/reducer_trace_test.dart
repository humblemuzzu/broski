import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fixture_json.dart';

/// The Dart reducer against the TypeScript one: `reducer_trace.json` holds,
/// for every case, each event and the snapshot and status `applyEvent` and
/// `sessionStatus` gave after it in TypeScript. Nothing here is written by hand.
void main() {
  final trace = objectAt(generatedFixture('reducer_trace.json'), 'trace');
  final cases = listAt(trace['cases'], 'cases');

  test('the trace has cases', () => expect(cases, isNotEmpty));

  for (final entry in cases) {
    final traced = objectAt(entry, 'case');
    final name = stringAt(traced['name'], 'name');
    test(name, () {
      var snapshot = SessionSnapshot.fromJson(
        objectAt(traced['initial'], 'initial'),
      );
      final steps = listAt(traced['steps'], 'steps');
      for (final (index, raw) in steps.indexed) {
        final step = objectAt(raw, 'step');
        final record = objectAt(step['record'], 'record');
        final event = AgentEvent.fromJson(objectAt(record['event'], 'event'));
        final at = switch (record['at']) {
          final int at => at,
          _ => throw const FormatException('at is not an integer'),
        };
        snapshot = applyEvent(snapshot, at, event);
        final where = 'step $index (${event.toJson()['type']})';
        _expectSnapshot(snapshot, step, where);
        expect(
          sessionStatus(snapshot).wire,
          stringAt(step['status'], 'status'),
          reason: where,
        );
      }
    });
  }
}

void _expectSnapshot(
  SessionSnapshot snapshot,
  Map<String, Object?> step,
  String where,
) {
  final actual = canonicalJson(snapshot.toJson());
  if (step.containsKey('expected')) {
    final difference = firstDifference(actual, canonicalJson(step['expected']));
    if (difference != null) fail('$where: $difference');
    return;
  }
  expect(
    sha256Hex(actual),
    stringAt(step['expectedSha256'], 'expectedSha256'),
    reason: '$where: a snapshot of ${actual.length} characters',
  );
}
