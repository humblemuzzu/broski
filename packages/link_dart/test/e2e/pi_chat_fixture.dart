import 'dart:io';

import 'package:path/path.dart' as p;

import 'link_sandbox.dart';
import 'scripted_openai.dart';

/// A git repo and a Pi provider that points at a [ScriptedOpenAi], both inside
/// the bridge's own throwaway home: nothing of the developer's `~/.pi` is read.
final class PiChatFixture {
  PiChatFixture._(this.cwd);

  /// The project path the phone names in `projectPath`.
  final String cwd;

  static Future<PiChatFixture> create(
    LinkSandbox sandbox,
    ScriptedOpenAi model,
  ) async {
    final cwd = p.join(sandbox.bridgeHome, 'repo');
    await Directory(cwd).create(recursive: true);
    final init = await Process.run('git', ['init', '-q', cwd]);
    if (init.exitCode != 0) {
      throw StateError('git init failed: ${init.stderr}');
    }
    final agentDir = Directory(p.join(sandbox.bridgeHome, '.pi', 'agent'));
    await agentDir.create(recursive: true);
    await File(
      p.join(agentDir.path, 'models.json'),
    ).writeAsString(model.modelsJson());
    return PiChatFixture._(cwd);
  }
}
