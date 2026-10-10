import 'dart:io';
import 'dart:isolate';

import 'package:path/path.dart' as p;

/// The `broski-relay` and `broski-link` release binaries the e2e suite drives.
final class LinkBinaries {
  const LinkBinaries({required this.relay, required this.daemon});

  final String relay;
  final String daemon;
}

Future<LinkBinaries>? _building;

/// Builds `packages/link` once per test run and returns the two binaries.
///
/// Concurrent test files share one cargo target directory, so cargo serialises
/// the builds for us.
Future<LinkBinaries> linkBinaries() => _building ??= _build();

Future<LinkBinaries> _build() async {
  final cargo = await _cargo();
  final workspace = await _workspace();
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
    'the Broski Link e2e suite drives the real broski-link and broski-relay '
    'binaries, so it needs cargo; install Rust (https://rustup.rs) and re-run.',
  );
}

Future<String> _workspace() async {
  final resolved = await Isolate.resolvePackageUri(
    Uri.parse('package:broski_link/broski_link.dart'),
  );
  if (resolved == null) {
    throw StateError('package:broski_link did not resolve to a file');
  }
  final packages = p.dirname(p.dirname(p.dirname(resolved.toFilePath())));
  return p.join(packages, 'link');
}
