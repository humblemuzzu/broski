import 'dart:convert';
import 'dart:io';

import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import 'generated/contract_round_trips.dart';

Object? _fixture(String name) =>
    jsonDecode(File('test/contract/fixtures/$name').readAsStringSync());

void main() {
  final samples = _fixture('contract_samples.json')! as Map<String, Object?>;

  test('every contract type has samples and a generated codec', () {
    expect(samples.keys.toSet(), contractRoundTrips.keys.toSet());
    expect(samples.keys.toSet(), contractDecoders.keys.toSet());
  });

  group('the Dart models round-trip every TypeScript sample', () {
    for (final MapEntry(key: type, value: values) in samples.entries) {
      test(type, () {
        final roundTrip = contractRoundTrips[type]!;
        for (final sample in values! as List<Object?>) {
          expect(roundTrip(sample), sample);
        }
      });
    }
  });

  group('two decodes of one sample are equal values', () {
    for (final MapEntry(key: type, value: values) in samples.entries) {
      test(type, () {
        final decode = contractDecoders[type]!;
        for (final sample in values! as List<Object?>) {
          final first = decode(sample);
          final second = decode(jsonDecode(jsonEncode(sample)));
          expect(first, second);
          if (first is! List && first is! Map) {
            expect(first.hashCode, second.hashCode);
          }
          expect(first.toString(), second.toString());
        }
      });
    }
  });

  test('a fake backend session decodes as server messages', () {
    final messages = _fixture('fake_session_stream.json')! as List<Object?>;
    for (final message in messages) {
      final json = message! as Map<String, Object?>;
      expect(ServerMessage.fromJson(json).toJson(), json);
    }
  });

  test('different values are not equal', () {
    const one = SessionRef(backend: BackendId.pi, sessionId: 'a');
    expect(one, const SessionRef(backend: BackendId.pi, sessionId: 'a'));
    expect(one, isNot(const SessionRef(backend: BackendId.pi, sessionId: 'b')));
    expect(
      const PlanItem(text: 'x', status: PlanItemStatus.pending),
      isNot(const PlanItem(text: 'x', status: PlanItemStatus.completed)),
    );
    expect(one.toString(), 'SessionRef(backend: BackendId.pi, sessionId: a)');
  });

  group('a payload of the wrong shape is a FormatException', () {
    test('an unknown union tag', () {
      expect(
        () => ServerMessage.fromJson({
          'type': 'from.the.future',
          'requestId': '1',
        }),
        throwsFormatException,
      );
    });

    test('an unknown enum value', () {
      expect(() => BackendId.fromJson('emacs'), throwsFormatException);
    });

    test('a missing required field', () {
      expect(
        () => SessionRef.fromJson({'backend': 'pi'}),
        throwsFormatException,
      );
    });

    test('a field of the wrong type', () {
      expect(
        () => SessionRef.fromJson({'backend': 'pi', 'sessionId': 7}),
        throwsFormatException,
      );
      expect(() => Plan.fromJson({'items': 'none'}), throwsFormatException);
    });

    test('a field the schema does not define', () {
      expect(
        () => SessionRef.fromJson({
          'backend': 'pi',
          'sessionId': 'a',
          'path': '/x',
        }),
        throwsFormatException,
      );
    });

    test('a member decoded with another member\'s tag', () {
      expect(
        () => AgentMention.fromJson({'kind': 'file', 'name': 'x'}),
        throwsFormatException,
      );
    });
  });
}
