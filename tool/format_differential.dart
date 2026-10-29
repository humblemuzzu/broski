import 'dart:convert';
import 'dart:io';

import 'package:broski/agent/answers/js_pattern.dart';
import 'package:broski/agent/answers/string_formats.dart';
import 'package:broski/contract/generated/contract.dart';

/// Holds the app's string checks to the bridge's on a seeded corpus that
/// `packages/bridge/scripts/format-corpus.ts` builds and judges under Bun.
///
///   dart run tool/format_differential.dart [--seed N] [--count N]
///
/// Fails on any difference, except the two the app core README (§8) allows,
/// both a `uri` the app accepts and the bridge refuses, where the bridge's own
/// check stays the authority: a Unicode host (written out, or as an `xn--`
/// label), and a label Bun's URL parser refuses against the WHATWG standard
/// ([_overflowsOnAZero]). The app refusing what the bridge accepts is never
/// allowed.
Future<void> main(List<String> args) async {
  final corpus = await Process.run('bun', [
    'scripts/format-corpus.ts',
    ...args,
  ], workingDirectory: 'packages/bridge');
  if (corpus.exitCode != 0) {
    stderr.writeln('format-corpus.ts failed:\n${corpus.stderr}');
    exit(2);
  }
  final tally = <String, _Tally>{};
  for (final raw in const LineSplitter().convert('${corpus.stdout}')) {
    final line = _CorpusLine.parse(raw);
    tally.putIfAbsent(line.check, _Tally.new).add(line);
  }
  var failed = false;
  for (final MapEntry(key: check, value: counts) in tally.entries) {
    stdout.writeln(counts.summary(check));
    failed |= counts.failing.isNotEmpty;
  }
  exit(failed ? 1 : 0);
}

final class _CorpusLine {
  _CorpusLine(this.check, this.text, this.pattern, this.problem);

  factory _CorpusLine.parse(String raw) => switch (jsonDecode(raw)) {
    {
          'check': final String check,
          'text': final String text,
          'problem': final String? problem,
        } &&
        final Map<String, Object?> json =>
      switch (json['pattern']) {
        final String? pattern => _CorpusLine(check, text, pattern, problem),
        _ => throw FormatException('a pattern is text: $raw'),
      },
    _ => throw FormatException('not a corpus line: $raw'),
  };

  final String check;
  final String text;
  final String? pattern;
  final String? problem;

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
/// standard; a text holding U+0000, whose `u` reading Dart's engine gets
/// wrong; and an escaped astral character, which JavaScriptCore compiles
/// under `u` against the standard and Dart's engine refuses.
bool _leftToTheBridge(_CorpusLine line) => switch (line.pattern) {
  null =>
    line.check == 'uri' &&
        (line.text.runes.any((point) => point > 0x7e) ||
            line.text.toLowerCase().contains('xn--') ||
            _overflowsOnAZero(line.text)),
  final pattern =>
    line.text.contains('\u0000') ||
        RegExp(r'\\[\u{10000}-\u{10FFFF}]', unicode: true).hasMatch(pattern),
};

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
  final List<String> failing = [];
  final List<String> allowed = [];

  void add(_CorpusLine line) {
    lines++;
    final mine = line.appProblem();
    if (mine == line.problem) return;
    final shown =
        '${jsonEncode(line.pattern ?? '')} ${jsonEncode(line.text)}: '
        'bridge ${line.problem ?? 'passes'}, app ${mine ?? 'passes'}';
    final approximated = mine == null && _leftToTheBridge(line);
    (approximated ? allowed : failing).add(shown);
  }

  String summary(String check) => [
    '$check: $lines lines, ${failing.length} differences, '
        '${allowed.length} the app passes and leaves to the bridge',
    for (final shown in failing.take(20)) '  DIFFERENT $shown',
    for (final shown in allowed.take(5)) '  allowed   $shown',
  ].join('\n');
}
