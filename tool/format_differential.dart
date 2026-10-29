import 'dart:convert';
import 'dart:io';

import 'package:broski/agent/answers/js_pattern.dart';
import 'package:broski/agent/answers/string_formats.dart';
import 'package:broski/contract/generated/contract.dart';

/// Holds the app's string checks to the bridge's, line by line, on a corpus
/// `packages/bridge/scripts/format-corpus.ts` builds and judges under Bun: a
/// seeded random one, or an exhaustive sweep (every code point as a host, as a
/// Punycode label, as an escape in a pattern, ...).
///
///   dart run tool/format_differential.dart [--seed N] [--count N]
///   dart run tool/format_differential.dart --sweep NAME|all
///
/// Fails on any difference but what the app core README (§8) says the app
/// passes and leaves to the bridge; the app refusing what the bridge accepts
/// is never allowed.
Future<void> main(List<String> args) async {
  final sweeps = _sweepsIn(args);
  var failed = false;
  var lines = 0;
  for (final sweep in sweeps) {
    final tally = <String, _Tally>{};
    await for (final raw in _corpus(args, sweep)) {
      final line = _CorpusLine.parse(raw);
      tally.putIfAbsent(line.check, _Tally.new).add(line);
    }
    stdout.writeln(sweep == null ? 'random corpus' : 'sweep $sweep');
    for (final MapEntry(key: check, value: counts) in tally.entries) {
      stdout.writeln(counts.summary(check));
      failed |= counts.failing.isNotEmpty;
      lines += counts.lines;
    }
  }
  stdout.writeln('${failed ? 'FAILED' : 'agreed'}: $lines lines in all');
  exit(failed ? 1 : 0);
}

const _sweepNames = [
  'hosts',
  'labels',
  'short-labels',
  'escapes',
  'negated-classes',
  'properties',
  'pair-starts',
  'digit-hosts',
];

/// The sweeps asked for, or null once for the seeded corpus.
List<String?> _sweepsIn(List<String> args) {
  final at = args.indexOf('--sweep');
  if (at < 0) return [null];
  final name = args.elementAtOrNull(at + 1);
  if (name == 'all') return _sweepNames;
  if (!_sweepNames.contains(name)) {
    stderr.writeln('--sweep takes all or one of: ${_sweepNames.join(', ')}');
    exit(2);
  }
  return [name];
}

Stream<String> _corpus(List<String> args, String? sweep) async* {
  final passed = [
    for (var index = 0; index < args.length; index++)
      if (args[index] != '--sweep' &&
          (index == 0 || args[index - 1] != '--sweep'))
        args[index],
  ];
  final process = await Process.start('bun', [
    'scripts/format-corpus.ts',
    ...passed,
    if (sweep != null) ...['--sweep', sweep],
  ], workingDirectory: 'packages/bridge');
  final errors = process.stderr.transform(utf8.decoder).join();
  yield* process.stdout.transform(utf8.decoder).transform(const LineSplitter());
  if (await process.exitCode != 0) {
    stderr.writeln('format-corpus.ts failed:\n${await errors}');
    exit(2);
  }
}

final class _CorpusLine {
  _CorpusLine(this.check, this.text, this.pattern, this.problem, this.kind);

  factory _CorpusLine.parse(String raw) => switch (jsonDecode(raw)) {
    {
          'check': final String check,
          'text': final String text,
          'problem': final String? problem,
        } &&
        final Map<String, Object?> json =>
      switch ((json['pattern'], json['kind'])) {
        (final String? pattern, final String? kind) => _CorpusLine(
          check,
          text,
          pattern,
          problem,
          kind,
        ),
        _ => throw FormatException('a pattern and a kind are text: $raw'),
      },
    _ => throw FormatException('not a corpus line: $raw'),
  };

  final String check;
  final String text;
  final String? pattern;
  final String? problem;

  /// What the line is about, when the corpus says.
  final String? kind;

  /// What the app finds: null when it passes.
  String? appProblem() {
    final pattern = this.pattern;
    if (pattern != null) return patternProblem(pattern, text);
    final format = StringFormat.fromJson(check);
    return matchesFormat(format, text) ? null : 'not a valid $check';
  }
}

/// What the app core README (§8) says the app passes and leaves to the
/// bridge: a Unicode host; a host Bun's URL parser refuses against the
/// standard; a property escape, which the app judges only for ASCII text; the
/// escape of an astral character, which JavaScriptCore reads as no character;
/// a modifier group; and a back reference to a name two groups share. Which
/// of them a line is, or null.
String? _leftToTheBridge(_CorpusLine line) => switch (line.pattern) {
  null when line.check != 'uri' => null,
  null when _overflowsOnAZero(line.text) => 'a digit label Bun refuses',
  null when line.text.toLowerCase().contains('xn--') => 'a Punycode label',
  null when line.text.runes.any((point) => point > 0x7e) => 'a Unicode host',
  null => null,
  final pattern when _astralEscape.hasMatch(pattern) => 'an astral escape',
  final pattern when _modifierGroup.hasMatch(pattern) => 'a modifier group',
  final pattern when _referencesSharedName(pattern) => 'a shared group name',
  final pattern
      when _propertyEscape.hasMatch(pattern) &&
          line.text.codeUnits.any((unit) => unit > 0x7f) =>
    'a property escape beyond ASCII',
  _ => null,
};

final _modifierGroup = RegExp(r'\(\?[ims]*(?:-[ims]*)?:');

bool _referencesSharedName(String pattern) {
  final names = [
    for (final match in RegExp(r'\(\?<([^=!>][^>]*)>').allMatches(pattern))
      match[1],
  ];
  return RegExp(r'\\k<([^>]*)>')
      .allMatches(pattern)
      .any(
        (reference) => names.where((name) => name == reference[1]).length > 1,
      );
}

final _propertyEscape = RegExp(r'(?<!\\)(?:\\\\)*\\[pP]\{');
final _astralEscape = RegExp(
  r'(?<!\\)(?:\\\\)*\\[\u{10000}-\u{10FFFF}]',
  unicode: true,
);

/// Bun (WebKit) refuses a host label of decimal digits that pass 2^32 - 1 only
/// with a last `0`, followed by `x` (`10000000000X`), where the standard reads
/// a domain; seen on every such label of 130,000 sampled. The app keeps to
/// the standard, since copying a parser's quirk would refuse what a fixed one
/// accepts.
bool _overflowsOnAZero(String text) {
  final max = BigInt.from(0xffffffff);
  return RegExp(r'(?:^|[^0-9])([0-9]+)0[xX]').allMatches(text).any((match) {
    final head = BigInt.parse(match[1] ?? '0');
    return head <= max && head * BigInt.from(10) > max;
  });
}

final class _Tally {
  var lines = 0;
  var differences = 0;
  var allowed = 0;

  /// The first few of each, shown.
  final List<String> failing = [];
  final List<String> samples = [];
  final Map<String, int> allowedKinds = {};

  void add(_CorpusLine line) {
    lines++;
    final mine = line.appProblem();
    if (mine == line.problem) return;
    final shown =
        '${jsonEncode(line.pattern ?? '')} ${jsonEncode(line.text)}: '
        'bridge ${line.problem ?? 'passes'}, app ${mine ?? 'passes'}';
    final reason = mine == null ? _leftToTheBridge(line) : null;
    if (reason != null) {
      allowed++;
      if (samples.length < 5) samples.add(shown);
      final kind = line.kind == null ? reason : '$reason, ${line.kind}';
      allowedKinds[kind] = (allowedKinds[kind] ?? 0) + 1;
    } else {
      differences++;
      if (failing.length < 20) failing.add(shown);
    }
  }

  String summary(String check) => [
    '$check: $lines lines, $differences differences, '
        '$allowed the app passes and leaves to the bridge'
        '${allowedKinds.isEmpty ? '' : ' (${_kinds()})'}',
    for (final shown in failing) '  DIFFERENT $shown',
    for (final shown in samples) '  allowed   $shown',
  ].join('\n');

  String _kinds() => [
    for (final MapEntry(:key, :value) in allowedKinds.entries) '$value $key',
  ].join(', ');
}
