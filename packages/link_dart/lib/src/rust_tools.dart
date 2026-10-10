import 'dart:io';

import 'package:path/path.dart' as p;

/// The absolute path of the Rust [tool], searched on `PATH` and then in
/// `~/.cargo/bin` — the latter because IDEs launch Flutter without the shell's
/// cargo entry on `PATH`.
String? resolveRustTool(String tool) {
  final environment = Platform.environment;
  final home = environment['HOME'];
  for (final directory in <String>[
    ...?environment['PATH']?.split(':'),
    if (home != null) p.join(home, '.cargo', 'bin'),
  ]) {
    final candidate = p.join(directory, tool);
    if (File(candidate).existsSync()) {
      return candidate;
    }
  }
  return null;
}
