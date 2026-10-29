import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';

/// A generated fixture under `test/contract/fixtures/`, with every long string
/// the generator wrote as runs (`fixture-text.ts`) expanded back.
Object? generatedFixture(String name) => expandLongStrings(
  jsonDecode(File('test/contract/fixtures/$name').readAsStringSync()),
);

const _runsKey = r'$runs';

Object? expandLongStrings(Object? value) => switch (value) {
  {_runsKey: final List<Object?> runs} => runs.map(_run).join(),
  final Map<String, Object?> map => {
    for (final MapEntry(:key, :value) in map.entries)
      key: expandLongStrings(value),
  },
  final List<Object?> list => [
    for (final item in list) expandLongStrings(item),
  ],
  _ => value,
};

String _run(Object? run) => switch (run) {
  [final String unit, final int count] => unit * count,
  _ => throw FormatException('a run is [codePoint, count], not $run'),
};

/// The JSON of [value] with every object's keys in code-unit order, as the
/// generator's `canonical-json.ts` writes it.
String canonicalJson(Object? value) => jsonEncode(_sorted(value));

String sha256Hex(String text) => sha256.convert(utf8.encode(text)).toString();

/// Null when [actual] equals [expected]; else where they first differ, with a
/// short window of each, so a megabyte of text never floods a failure.
String? firstDifference(String actual, String expected) {
  if (actual == expected) return null;
  var index = 0;
  final shorter = actual.length < expected.length
      ? actual.length
      : expected.length;
  while (index < shorter && actual[index] == expected[index]) {
    index++;
  }
  String window(String text) {
    final start = index < 60 ? 0 : index - 60;
    final end = index + 60 > text.length ? text.length : index + 60;
    return text.substring(start, end);
  }

  return 'first difference at character $index of ${actual.length} '
      '(expected ${expected.length})\n'
      '  actual:   …${window(actual)}…\n'
      '  expected: …${window(expected)}…';
}

/// JSON has one number type: a whole double prints as JavaScript prints it.
Object? _sorted(Object? value) => switch (value) {
  final Map<String, Object?> map => {
    for (final key in map.keys.toList()..sort()) key: _sorted(map[key]),
  },
  final List<Object?> list => [for (final item in list) _sorted(item)],
  final double number
      when number == number.truncateToDouble() && number.abs() < 1e21 =>
    number.toInt(),
  _ => value,
};

Map<String, Object?> objectAt(Object? value, String what) => switch (value) {
  final Map<String, Object?> map => map,
  _ => throw FormatException('$what is not an object'),
};

List<Object?> listAt(Object? value, String what) => switch (value) {
  final List<Object?> list => list,
  _ => throw FormatException('$what is not a list'),
};

String stringAt(Object? value, String what) => switch (value) {
  final String text => text,
  _ => throw FormatException('$what is not a string'),
};
