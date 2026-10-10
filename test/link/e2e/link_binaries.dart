import 'dart:io';

import 'package:path/path.dart' as p;

/// The `broski-link` release binary the app's e2e test drives.
final class LinkBinaries {
  const LinkBinaries({required this.relay, required this.daemon});

  final String relay;
  final String daemon;
}

Future<LinkBinaries>? _building;

/// Builds `packages/link` once per test run and returns the two binaries.
Future<LinkBinaries> linkBinaries() => _building ??= _build();

Future<LinkBinaries> _build() async {
  final cargo = await _cargo();
  final workspace = p.join(_repositoryRoot(), 'packages', 'link');
  final build = await Process.run(cargo, [
    'build',
    '--release',
    '-p',
    'broski-relay',
    '-p',
    'broski-link-daemon',
  ], workingDirectory: workspace);
  if (build.exitCode != 0) {
    throw StateError(
      'cargo build --release -p broski-relay -p broski-link-daemon failed '
      '(exit ${build.exitCode}) in $workspace:\n${build.stdout}${build.stderr}',
    );
  }
  final release = p.join(workspace, 'target', 'release');
  final binaries = LinkBinaries(
    relay: p.join(release, 'broski-relay'),
    daemon: p.join(release, 'broski-link'),
  );
  for (final path in <String>[binaries.relay, binaries.daemon]) {
    if (!File(path).existsSync()) {
      throw StateError('cargo built no $path');
    }
  }
  return binaries;
}

Future<String> _cargo() async {
  final home = Platform.environment['HOME'];
  final candidates = <String>[
    if (home != null && home.isNotEmpty) p.join(home, '.cargo', 'bin', 'cargo'),
    'cargo',
  ];
  for (final candidate in candidates) {
    try {
      if ((await Process.run(candidate, ['--version'])).exitCode == 0) {
        return candidate;
      }
    } on ProcessException {
      continue;
    }
  }
  throw StateError(
    'the pairing e2e test drives the real broski-link daemon, so it needs '
    'cargo; install Rust (https://rustup.rs) and re-run.',
  );
}

String _repositoryRoot() {
  var directory = Directory.current.absolute;
  while (true) {
    if (File(
      p.join(directory.path, 'packages', 'link', 'Cargo.toml'),
    ).existsSync()) {
      return directory.path;
    }
    final parent = directory.parent;
    if (parent.path == directory.path) {
      throw StateError(
        'no packages/link above ${Directory.current.path}; run the test from '
        'the repository root',
      );
    }
    directory = parent;
  }
}
