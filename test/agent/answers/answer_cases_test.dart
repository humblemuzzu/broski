import 'package:broski/agent/answers/answer_check.dart';
import 'package:broski/agent/answers/field_check.dart';
import 'package:broski/agent/answers/url/url_can_parse.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fixture_json.dart';

/// The Dart answer check against the TypeScript one: `answer_cases.json`
/// holds answers with the problem `answerProblem` found for each in
/// TypeScript, and fields with the activity `fieldIsActive` computed.
void main() {
  final fixture = objectAt(generatedFixture('answer_cases.json'), 'fixture');

  group('answerProblem agrees with the contract', () {
    for (final raw in listAt(fixture['answers'], 'answers')) {
      final entry = objectAt(raw, 'answer case');
      final name = stringAt(entry['name'], 'name');
      test(name, () {
        final interaction = Interaction.fromJson(
          objectAt(entry['interaction'], 'interaction'),
        );
        final answer = InteractionAnswer.fromJson(
          objectAt(entry['answer'], 'answer'),
        );
        expect(answerProblem(interaction, answer), entry['problem']);
      });
    }
  });

  test('fieldIsActive agrees with the contract', () {
    final cases = listAt(fixture['activity'], 'activity');
    expect(cases, isNotEmpty);
    for (final raw in cases) {
      final entry = objectAt(raw, 'activity case');
      final field = FormFieldSpec.fromJson(objectAt(entry['field'], 'field'));
      final values = {
        for (final MapEntry(:key, :value) in objectAt(
          entry['values'],
          'values',
        ).entries)
          key: FormValue.fromJson(objectAt(value, key)),
      };
      expect(fieldIsActive(field, values), entry['active'], reason: '$entry');
    }
  });

  test('a non-ASCII host the bridge accepts, the app accepts too', () {
    final cases = listAt(fixture['idnaHosts'], 'idnaHosts');
    expect(cases, isNotEmpty);
    for (final raw in cases) {
      final entry = objectAt(raw, 'host case');
      final input = stringAt(entry['input'], 'input');
      if (entry['canParse'] == true) {
        expect(urlCanParse(input), isTrue, reason: input);
      }
    }
  });
}
