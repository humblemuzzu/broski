import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:broski/contract/generated/contract.dart';
import 'package:path/path.dart' as p;

/// The real Bun bridge with the contract's fake backend in its core
/// (`packages/bridge/scripts/dev-fake-bridge.ts`), serving the daemon's
/// bridge socket, in a home of its own under the temp directory.
final class FakeBridgeProcess {
  FakeBridgeProcess._(this._process, this._home) {
    _process.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(_line);
    _process.stderr
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(_log.add);
  }

  static const _mark = 'FAKE-BRIDGE ';

  static Future<FakeBridgeProcess> start({
    required String socket,
    required String keyFile,
    Duration idleClose = const Duration(milliseconds: 200),
  }) async {
    final home = await Directory.systemTemp.createTemp('broski-fake-bridge-');
    final process = await Process.start(
      await _bun(),
      [
        'scripts/dev-fake-bridge.ts',
        '--link-socket',
        socket,
        '--link-key-file',
        keyFile,
        '--idle-close-ms',
        '${idleClose.inMilliseconds}',
      ],
      workingDirectory: p.join(_repositoryRoot(), 'packages', 'bridge'),
      includeParentEnvironment: false,
      environment: {
        'PATH': ?Platform.environment['PATH'],
        'TMPDIR': ?Platform.environment['TMPDIR'],
        'HOME': home.path,
        'XDG_CONFIG_HOME': p.join(home.path, '.config'),
        'XDG_DATA_HOME': p.join(home.path, '.local', 'share'),
        'XDG_STATE_HOME': p.join(home.path, '.local', 'state'),
        'XDG_CACHE_HOME': p.join(home.path, '.cache'),
        'PI_CODING_AGENT_DIR': p.join(home.path, 'pi-agent'),
      },
    );
    final bridge = FakeBridgeProcess._(process, home);
    await bridge._awaitSaid((message) => message['ready'] == true, 'ready');
    return bridge;
  }

  final Process _process;
  final Directory _home;
  final List<Map<String, Object?>> _messages = [];
  final List<String> _log = [];
  final _arrivals = StreamController<void>.broadcast();
  var _commands = 0;

  /// A session with one finished exchange in its history.
  Future<SessionRef> seed(String cwd) async {
    final answer = await _command({'cmd': 'seed', 'cwd': cwd});
    return switch (answer['session']) {
      final Map<String, Object?> session => SessionRef.fromJson(session),
      _ => throw StateError('seed answered $answer'),
    };
  }

  /// The session's next run plays the named scenario.
  Future<void> script(SessionRef session, String scenario) => _command({
    'cmd': 'script',
    'session': session.toJson(),
    'scenario': scenario,
  });

  /// Ends the `hold` step of the session's run.
  Future<void> release(SessionRef session) =>
      _command({'cmd': 'release', 'session': session.toJson()});

  /// Waits until the bridge closed the session, as its idle close does.
  Future<void> closed(SessionRef session) => _awaitSaid(
    (message) => switch (message['closed']) {
      final Map<String, Object?> closed =>
        SessionRef.fromJson(closed) == session,
      _ => false,
    },
    'the close of ${session.sessionId}',
  );

  Future<void> stop() async {
    await _process.stdin.close();
    await _process.exitCode.timeout(
      const Duration(seconds: 10),
      onTimeout: () {
        _process.kill(ProcessSignal.sigkill);
        return -1;
      },
    );
    await _arrivals.close();
    await _home.delete(recursive: true);
  }

  Future<Map<String, Object?>> _command(Map<String, Object?> command) async {
    final id = ++_commands;
    _process.stdin.writeln(jsonEncode({...command, 'id': id}));
    final answer = await _awaitSaid(
      (message) => message['id'] == id,
      'command $id',
    );
    if (answer['error'] case final String error) throw StateError(error);
    return answer;
  }

  Future<Map<String, Object?>> _awaitSaid(
    bool Function(Map<String, Object?> message) test,
    String what,
  ) async {
    final deadline = DateTime.now().add(const Duration(seconds: 60));
    while (true) {
      for (final message in _messages) {
        if (test(message)) return message;
      }
      final remaining = deadline.difference(DateTime.now());
      if (remaining.isNegative) {
        throw StateError(
          'the fake bridge never said $what:\n${_log.join('\n')}',
        );
      }
      await _arrivals.stream.first.timeout(remaining, onTimeout: () {});
    }
  }

  void _line(String line) {
    if (!line.startsWith(_mark)) {
      _log.add(line);
      return;
    }
    final message = jsonDecode(line.substring(_mark.length));
    if (message is Map<String, Object?>) _messages.add(message);
    if (!_arrivals.isClosed) _arrivals.add(null);
  }
}

String _repositoryRoot() {
  var directory = Directory.current.absolute;
  while (!File(
    p.join(directory.path, 'packages', 'bridge', 'package.json'),
  ).existsSync()) {
    final parent = directory.parent;
    if (parent.path == directory.path) {
      throw StateError(
        'run the test from the repository: no packages/bridge above ${Directory.current.path}',
      );
    }
    directory = parent;
  }
  return directory.path;
}

Future<String> _bun() async {
  final home = Platform.environment['HOME'];
  for (final candidate in [
    if (home != null) p.join(home, '.bun', 'bin', 'bun'),
    'bun',
  ]) {
    try {
      if ((await Process.run(candidate, ['--version'])).exitCode == 0) {
        return candidate;
      }
    } on ProcessException {
      continue;
    }
  }
  throw StateError('the fake bridge is a Bun program; install Bun and re-run');
}
