import 'dart:io';

import 'agent_core_check/agent_core_rules.dart';
import 'agent_core_check/import_rules.dart';

/// Fails when a file under lib/agent/ steers by backend or reaches outside
/// the layers it may use, or when an app layer it imports whole exports
/// something outside them (docs/architecture/app-core/README.md, "Rules").
///
///   dart run tool/check_agent_core.dart
void main() {
  final root = Directory('lib/agent');
  if (!root.existsSync()) {
    stderr.writeln('run from the repository root: lib/agent/ is not here');
    exit(2);
  }
  final core = _dartFiles(root);
  final theme = _dartFiles(Directory('lib/theme'));
  final problems = [
    for (final (path, source) in core) ...agentCoreViolations(path, source),
    for (final (path, source) in theme)
      ...openLayerExportProblems(path, source),
  ];
  if (problems.isNotEmpty) {
    stderr.writeln('The app core breaks its rules:\n${problems.join('\n')}');
    exit(1);
  }
  stdout.writeln(
    'agent core: ${core.length} files under lib/agent steer by capability '
    'only; ${theme.length} theme files export nothing outside the layers',
  );
}

List<(String, String)> _dartFiles(Directory root) {
  final files =
      root
          .listSync(recursive: true)
          .whereType<File>()
          .where((file) => file.path.endsWith('.dart'))
          .toList()
        ..sort((a, b) => a.path.compareTo(b.path));
  return [
    for (final file in files)
      (file.path.replaceAll(r'\', '/'), file.readAsStringSync()),
  ];
}
