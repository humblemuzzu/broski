import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:path/path.dart' as p;
import 'package:test/test.dart';

import 'link_sandbox.dart';

/// A throwaway `$HOME` (and XDG dirs) for the supervised bridge, so nothing it
/// writes lands in the developer's real home. The daemon passes its own
/// environment to the child, so this reaches the bridge.
Map<String, String> sandboxEnvironment(LinkSandbox sandbox) {
  final home = sandbox.bridgeHome;
  return <String, String>{
    'HOME': home,
    'XDG_CONFIG_HOME': p.join(home, '.config'),
    'XDG_DATA_HOME': p.join(home, '.local', 'share'),
    'XDG_STATE_HOME': p.join(home, '.local', 'state'),
    'XDG_CACHE_HOME': p.join(home, '.cache'),
  };
}

/// The repo's real Bun bridge, as the daemon's `--bridge-cmd`: headless, an
/// ephemeral port, and the `--link-socket` the daemon appends to it.
Future<List<String>> realBridgeCommand() async {
  final root = await _repoRoot();
  return <String>[
    await _bun(),
    p.join(root, 'packages', 'bridge', 'bin', 'broski.ts'),
    'serve',
    '--daemon',
    '--skip-wizard',
    '--port',
    '0',
  ];
}

/// The real bridge the daemon supervises.
final class RealBridge {
  RealBridge._(this._sandbox, this.pid);

  final LinkSandbox _sandbox;
  final int pid;

  /// Waits for the daemon to report the bridge up, then finds its process.
  static Future<RealBridge> up(
    LinkSandbox sandbox, {
    Duration timeout = const Duration(seconds: 90),
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (true) {
      final status = await sandbox.status();
      if (_bridgeState(status) == 'up') {
        final pid = await _bridgePid(sandbox);
        if (pid != null) {
          return RealBridge._(sandbox, pid);
        }
      }
      if (DateTime.now().isAfter(deadline)) {
        fail(
          'the supervised bridge never came up (state '
          '${_bridgeState(status)}):\n${sandbox.tail()}',
        );
      }
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
  }

  /// Kills the bridge process itself, the way a crash would. The daemon
  /// restarts it.
  Future<void> crash() async {
    Process.killPid(pid, ProcessSignal.sigkill);
    final deadline = DateTime.now().add(const Duration(seconds: 30));
    while (await _bridgePid(_sandbox) == pid) {
      if (DateTime.now().isAfter(deadline)) {
        fail('bridge process $pid is still there after SIGKILL');
      }
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
  }
}

/// A process's resident set in KiB, or null once it is gone.
Future<int?> rssKb(int pid) async {
  final result = await Process.run('ps', <String>['-o', 'rss=', '-p', '$pid']);
  return int.tryParse('${result.stdout}'.trim());
}

/// The state the daemon reports for the bridge in a `status` reply.
String _bridgeState(Map<String, Object?> status) {
  final bridge = status['bridge'];
  return bridge is Map ? '${bridge['state']}' : 'unknown';
}

/// The supervised bridge's process, found by the link socket only it was given.
Future<int?> _bridgePid(LinkSandbox sandbox) async {
  final result = await Process.run('ps', <String>['-axo', 'pid=,args=']);
  final marker = '--link-socket ${sandbox.bridgeSocket}';
  for (final line in const LineSplitter().convert('${result.stdout}')) {
    if (line.contains(marker)) {
      return int.tryParse(line.trim().split(RegExp(r'\s+')).first);
    }
  }
  return null;
}

Future<String> _repoRoot() async {
  final resolved = await Isolate.resolvePackageUri(
    Uri.parse('package:broski_link/broski_link.dart'),
  );
  if (resolved == null) {
    throw StateError('package:broski_link did not resolve to a file');
  }
  final dart = resolved.toFilePath();
  return p.dirname(p.dirname(p.dirname(p.dirname(dart))));
}

Future<String> _bun() async {
  final home = Platform.environment['HOME'];
  final candidates = <String>[
    if (home != null && home.isNotEmpty) p.join(home, '.bun', 'bin', 'bun'),
    'bun',
  ];
  for (final candidate in candidates) {
    try {
      if ((await Process.run(candidate, <String>['--version'])).exitCode == 0) {
        return candidate;
      }
    } on ProcessException {
      continue;
    }
  }
  throw StateError('the real bridge is a Bun program; install Bun and re-run');
}
