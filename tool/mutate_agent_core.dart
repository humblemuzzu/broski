import 'dart:async';
import 'dart:io';

import 'agent_core_mutants/frame_mutants.dart';
import 'agent_core_mutants/mutant.dart';
import 'agent_core_mutants/offline_mutants.dart';
import 'agent_core_mutants/port_mutants.dart';
import 'agent_core_mutants/session_mutants.dart';

/// Mutation check of the app core. Each mutant changes one guard in a copy of
/// the app, and the agent tests (end to end excepted) and those of the
/// notification taps must fail on it; one that leaves them green survives. A
/// mutant expected to survive says why it changes nothing a test can see
/// (`equivalent`).
///
///   dart run tool/mutate_agent_core.dart [--jobs N] [--check] [name filter]
///
/// `--check` only verifies that every mutant still matches its file. Exits 1
/// when a mutant survives without a reason, one with a reason is killed, one
/// no longer matches its file exactly once, or the unmutated copy fails.
Future<void> main(List<String> args) async {
  if (!Directory('lib/agent').existsSync()) {
    stderr.writeln('run from the repository root: lib/agent/ is not here');
    exit(2);
  }
  final jobsAt = args.indexOf('--jobs');
  final jobs = jobsAt >= 0 ? int.parse(args[jobsAt + 1]) : 3;
  final filter = [
    for (final (index, arg) in args.indexed)
      if (!arg.startsWith('--') && (index == 0 || args[index - 1] != '--jobs'))
        arg,
  ].firstOrNull;
  final mutants = [
    ...sessionMutants,
    ...frameMutants,
    ...portMutants,
    ...offlineMutants,
  ].where((mutant) => filter == null || mutant.name.contains(filter)).toList();
  final stale = [
    for (final mutant in mutants)
      if (_count(_source(mutant.file), mutant.find) case final count
          when count != 1)
        '${mutant.name}: matches lib/${mutant.file} $count times',
  ];
  if (stale.isNotEmpty) {
    stderr.writeln('Mutants out of date:\n${stale.join('\n')}');
    exit(1);
  }
  if (args.contains('--check')) {
    stdout.writeln('mutate: all ${mutants.length} mutants match their files');
    exit(0);
  }
  final baseline = _Copy.create();
  final clean = await baseline.test();
  baseline.delete();
  if (clean.verdict != _Verdict.survived) {
    stderr.writeln('the unmutated app fails its agent tests:\n${clean.output}');
    exit(1);
  }
  final queue = List.of(mutants);
  final outcomes = <(Mutant, _Verdict)>[];
  await Future.wait([
    for (var job = 0; job < jobs && job < queue.length; job++)
      _worker(queue, outcomes),
  ]);
  exit(_report(outcomes));
}

enum _Verdict { killed, survived, timedOut }

Future<void> _worker(
  List<Mutant> queue,
  List<(Mutant, _Verdict)> outcomes,
) async {
  final copy = _Copy.create();
  try {
    while (queue.isNotEmpty) {
      final mutant = queue.removeAt(0);
      final file = File('${copy.root}/lib/${mutant.file}');
      final original = file.readAsStringSync();
      file.writeAsStringSync(
        original.replaceFirst(mutant.find, mutant.replace),
      );
      final (:verdict, output: _) = await copy.test();
      file.writeAsStringSync(original);
      outcomes.add((mutant, verdict));
      stdout.writeln(
        '${verdict.name.toUpperCase().padRight(9)} ${mutant.name}',
      );
    }
  } finally {
    copy.delete();
  }
}

int _report(List<(Mutant, _Verdict)> outcomes) {
  final survived = [
    for (final (mutant, verdict) in outcomes)
      if (verdict == _Verdict.survived) mutant,
  ];
  final unexplained = survived.where((mutant) => mutant.equivalent == null);
  final disproved = [
    for (final (mutant, verdict) in outcomes)
      if (verdict != _Verdict.survived && mutant.equivalent != null) mutant,
  ];
  stdout.writeln(
    '\n${outcomes.length} mutants: ${outcomes.length - survived.length} killed',
  );
  for (final mutant in survived.where((mutant) => mutant.equivalent != null)) {
    stdout.writeln('equivalent: ${mutant.name} (${mutant.equivalent})');
  }
  for (final mutant in unexplained) {
    stderr.writeln('SURVIVED without a reason: ${mutant.name}');
  }
  for (final mutant in disproved) {
    stderr.writeln('killed although listed as equivalent: ${mutant.name}');
  }
  return unexplained.isEmpty && disproved.isEmpty ? 0 : 1;
}

String _source(String file) => File('lib/$file').readAsStringSync();

int _count(String source, String find) => find.allMatches(source).length;

/// The tests a mutant must fail: the app core's, its shared screens', and
/// those of the notification taps that open them.
const _testDirectories = [
  'test/agent',
  'test/screens/agent',
  'test/screens/notifications',
  'test/services/notifications',
];

/// A copy of what those tests need: the app's sources, the tests and the
/// helpers they share, with the packages, assets and fonts linked rather than
/// copied.
final class _Copy {
  _Copy(this.root);

  factory _Copy.create() {
    final root = Directory.systemTemp.createTempSync('broski-mutant-').path;
    for (final path in [
      'lib',
      ..._testDirectories,
      'test/support',
      'test/contract/fixtures',
    ]) {
      _copyTree(Directory(path), Directory('$root/$path'));
    }
    Directory('$root/test/agent/e2e').deleteSync(recursive: true);
    for (final file in [
      'pubspec.yaml',
      'pubspec.lock',
      'analysis_options.yaml',
      'dart_test.yaml',
      '.metadata',
      '.dart_tool/package_config.json',
      '.dart_tool/package_graph.json',
    ]) {
      File('$root/$file').parent.createSync(recursive: true);
      File(file).copySync('$root/$file');
    }
    for (final link in ['packages', 'assets', 'fonts', 'docs']) {
      Link('$root/$link').createSync(Directory(link).absolute.path);
    }
    return _Copy(root);
  }

  final String root;

  /// Killed when the tests fail or run past five minutes, since a mutant can
  /// make a test wait for what never comes.
  Future<({_Verdict verdict, String output})> test() async {
    final process = await Process.start('flutter', [
      'test',
      '--no-pub',
      '--reporter',
      'failures-only',
      ..._testDirectories,
    ], workingDirectory: root);
    final output = StringBuffer();
    final read = Future.wait([
      process.stdout.transform(systemEncoding.decoder).forEach(output.write),
      process.stderr.transform(systemEncoding.decoder).forEach(output.write),
    ]);
    final code = await process.exitCode.timeout(
      const Duration(minutes: 5),
      onTimeout: () {
        process.kill();
        return -1;
      },
    );
    await read;
    final verdict = switch (code) {
      -1 => _Verdict.timedOut,
      0 => _Verdict.survived,
      _ => _Verdict.killed,
    };
    return (verdict: verdict, output: output.toString());
  }

  void delete() => Directory(root).deleteSync(recursive: true);
}

void _copyTree(Directory from, Directory to) {
  to.createSync(recursive: true);
  for (final entity in from.listSync(recursive: true)) {
    final target = '${to.path}${entity.path.substring(from.path.length)}';
    if (entity is Directory) Directory(target).createSync(recursive: true);
    if (entity is File) {
      File(target).parent.createSync(recursive: true);
      entity.copySync(target);
    }
  }
}
