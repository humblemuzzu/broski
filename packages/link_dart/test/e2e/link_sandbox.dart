import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:broski_link/broski_link.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';

import 'link_binaries.dart';

/// A loopback port nothing is listening on: bind 0, read it, release it.
Future<int> freePort() async {
  final socket = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
  final port = socket.port;
  await socket.close();
  return port;
}

/// One throwaway machine: a temp directory, the real relay and daemon
/// processes, and the control socket that drives them.
final class LinkSandbox {
  LinkSandbox._(this._binaries, this.directory);

  static Future<LinkSandbox> create() async {
    final binaries = await linkBinaries();
    final directory = await Directory.systemTemp.createTemp('broski-e2e-');
    final sandbox = LinkSandbox._(binaries, directory);
    addTearDown(sandbox.dispose);
    return sandbox;
  }

  final LinkBinaries _binaries;
  final Directory directory;
  final List<Process> _processes = <Process>[];
  final List<String> _log = <String>[];
  final Set<String> _exited = <String>{};

  int? _lanPort;

  String get home => p.join(directory.path, 'home');
  String get bridgeSocket => p.join(directory.path, 'bridge.sock');
  String get controlSocket => p.join(home, 'control.sock');

  /// The daemon's LAN listener as a phone would dial it.
  String get lanCandidate => '127.0.0.1:$_lanPort';

  /// The daemon's LAN port, null when it does not listen on the LAN.
  int? get lanPort => _lanPort;

  Uri? _relayUrl;
  Process? _lastDaemon;

  Uri? get relay => _relayUrl;

  /// The daemon log and process output, for a failing assertion.
  String tail() => _log.isEmpty ? '(no process output)' : _log.join('\n');

  Future<void> dispose() async {
    if (Platform.environment['BROSKI_E2E_LOGS'] == '1') {
      stdout.writeln(tail());
    }
    for (final process in _processes.reversed) {
      process.kill(ProcessSignal.sigterm);
    }
    for (final process in _processes.reversed) {
      await process.exitCode.timeout(
        const Duration(seconds: 3),
        onTimeout: () {
          process.kill(ProcessSignal.sigkill);
          return -1;
        },
      );
    }
    try {
      await directory.delete(recursive: true);
    } on FileSystemException {
      // A leftover temp directory must never fail a test.
    }
  }

  Future<Uri> startRelay() async {
    final port = await freePort();
    await _spawn(_binaries.relay, <String>[
      '--listen',
      '127.0.0.1:$port',
      '--db',
      p.join(directory.path, 'relay.db'),
    ], 'relay');
    final url = Uri.parse('ws://127.0.0.1:$port');
    await _waitForHealth('http://127.0.0.1:$port/healthz');
    _relayUrl = url;
    return url;
  }

  /// Starts the daemon. [lan] false means it never listens on the LAN, and
  /// [relay] false that it never dials the relay.
  Future<void> startDaemon({bool lan = true, bool relay = false}) async {
    _lanPort = lan ? await freePort() : null;
    await _spawn(_binaries.daemon, <String>[
      'run',
      '--home',
      home,
      '--bridge-socket',
      bridgeSocket,
      if (lan) '--lan-port',
      if (lan) '$_lanPort',
      if (!lan) '--no-lan',
      if (relay) '--relay',
      if (relay) '$_relayUrl',
    ], 'daemon');
    await _waitForControl();
  }

  /// Kills the daemon the way a crash would, leaving its home behind.
  Future<void> killDaemon() async {
    final daemon = _lastDaemon;
    if (daemon == null || _exited.contains('daemon')) {
      return;
    }
    daemon.kill(ProcessSignal.sigkill);
    await daemon.exitCode;
    _exited.add('daemon');
  }

  /// One control-socket request, as `broski-link status --json` sends it.
  Future<Object?> ask(Map<String, Object?> request) async {
    final socket = await Socket.connect(
      InternetAddress(controlSocket, type: InternetAddressType.unix),
      0,
    ).timeout(const Duration(seconds: 5));
    try {
      socket.write('${jsonEncode(request)}\n');
      await socket.flush();
      final line = await utf8.decoder
          .bind(socket)
          .transform(const LineSplitter())
          .first
          .timeout(const Duration(seconds: 5));
      return jsonDecode(line);
    } finally {
      socket.destroy();
    }
  }

  /// The daemon's status, as `broski-link status --json` prints it.
  Future<Map<String, Object?>> status() async {
    final reply = await ask(<String, Object?>{'cmd': 'status'});
    if (reply is! Map) {
      throw StateError('status answered $reply');
    }
    return Map<String, Object?>.from(reply);
  }

  /// Every device the daemon has on file.
  Future<List<Object?>> devices() async {
    final reply = await ask(<String, Object?>{'cmd': 'devices'});
    if (reply is! List) {
      throw StateError('devices answered $reply');
    }
    return reply;
  }

  /// A freshly opened pairing offer.
  Future<PairingOffer> offer() async {
    final reply = await ask(<String, Object?>{'cmd': 'pair'});
    if (reply is! Map || reply['uri'] is! String) {
      throw StateError('pair answered $reply');
    }
    return PairingOffer.parse(reply['uri'] as String);
  }

  Future<void> _spawn(
    String binary,
    List<String> arguments,
    String name,
  ) async {
    final level = Platform.environment['BROSKI_E2E_RUST_LOG'];
    final process = await Process.start(
      binary,
      arguments,
      environment: level == null ? null : <String, String>{'RUST_LOG': level},
    );
    _processes.add(process);
    if (name == 'daemon') {
      _lastDaemon = process;
      _exited.remove('daemon');
    }
    void record(String line) {
      _log.add('$name: $line');
      if (_log.length > 400) {
        _log.removeAt(0);
      }
    }

    process.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(record);
    process.stderr
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(record);
    unawaited(
      process.exitCode.then((int code) {
        record('exited with $code');
        _exited.add(name);
      }),
    );
  }

  Future<void> _waitForControl() async {
    final deadline = DateTime.now().add(const Duration(seconds: 30));
    while (true) {
      if (_exited.contains('daemon')) {
        throw StateError(
          'the daemon exited before its control socket '
          'answered:\n${tail()}',
        );
      }
      try {
        await status();
        return;
      } on Object {
        if (DateTime.now().isAfter(deadline)) {
          throw StateError(
            'the daemon never answered on $controlSocket '
            '(lan=$_lanPort, relay=$_relayUrl):\n${tail()}',
          );
        }
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
    }
  }

  Future<void> _waitForHealth(String url) async {
    final client = HttpClient();
    final deadline = DateTime.now().add(const Duration(seconds: 30));
    try {
      while (true) {
        try {
          final request = await client.getUrl(Uri.parse(url));
          final response = await request.close();
          final body = await response.transform(utf8.decoder).join();
          if (response.statusCode == 200 && body.trim() == 'ok') {
            return;
          }
        } on Object {
          // not up yet
        }
        if (DateTime.now().isAfter(deadline)) {
          throw StateError('the relay never answered $url:\n${tail()}');
        }
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
    } finally {
      client.close(force: true);
    }
  }
}
