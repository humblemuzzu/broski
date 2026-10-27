import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

import 'link_binaries.dart';

/// A loopback port nothing is listening on: bind 0, read it, release it.
Future<int> freePort() async {
  final socket = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
  final port = socket.port;
  await socket.close();
  return port;
}

/// One throwaway machine: a temp home, the real `broski-link` process, and the
/// control socket that opens pairing offers on it.
final class LinkDaemon {
  LinkDaemon._(this.directory, this._lanPort);

  static Future<LinkDaemon> start() async {
    final directory = await Directory.systemTemp.createTemp('broski-app-e2e-');
    final daemon = LinkDaemon._(directory, await freePort());
    addTearDown(daemon.dispose);
    await daemon._launch();
    return daemon;
  }

  final Directory directory;
  int _lanPort;
  Process? _process;
  final List<String> _log = <String>[];

  String get home => p.join(directory.path, 'home');
  String get bridgeSocket => p.join(directory.path, 'bridge.sock');
  String get controlSocket => p.join(home, 'control.sock');

  int get lanPort => _lanPort;

  /// The daemon's LAN listener as a phone would dial it.
  String get lanCandidate => '127.0.0.1:$lanPort';

  /// Stops the daemon and starts it again on a port it was not serving, keeping
  /// its home: a machine that came back somewhere else on the same network.
  Future<void> restartOnNewPort() async {
    await _stop();
    final previous = _lanPort;
    var port = await freePort();
    while (port == previous) {
      port = await freePort();
    }
    _lanPort = port;
    await _launch();
  }

  /// The raw pairing uri the daemon opened, as the QR would carry it.
  Future<String> pairingUri() async {
    final reply = await _ask(<String, Object?>{'cmd': 'pair'});
    final uri = reply['uri'];
    if (uri is! String) {
      throw StateError('pair answered $reply');
    }
    return uri;
  }

  /// The pairing uri with [candidate] as its only LAN address.
  static String pointAt(String uri, String candidate) {
    final parsed = Uri.parse(uri);
    final query = <String>[
      for (final part in parsed.query.split('&'))
        if (!part.startsWith('l=')) part,
      'l=$candidate',
    ];
    return parsed.replace(query: query.join('&')).toString();
  }

  /// The daemon's status, as `broski-link status --json` prints it.
  Future<Map<String, Object?>> status() =>
      _ask(<String, Object?>{'cmd': 'status'});

  /// Every device the daemon has on file.
  Future<List<Object?>> devices() async {
    final reply = await _request(<String, Object?>{'cmd': 'devices'});
    if (reply is! List) {
      throw StateError('devices answered $reply');
    }
    return reply;
  }

  Future<void> dispose() async {
    await _stop();
    try {
      await directory.delete(recursive: true);
    } on FileSystemException {
      // A leftover temp directory must never fail a test.
    }
  }

  Future<void> _launch() async {
    final binaries = await linkBinaries();
    final process = await Process.start(binaries.daemon, <String>[
      'run',
      '--home',
      home,
      '--bridge-socket',
      bridgeSocket,
      '--lan-port',
      '$_lanPort',
      '--no-advertise',
    ]);
    _process = process;
    for (final output in <Stream<List<int>>>[process.stdout, process.stderr]) {
      output
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(_record);
    }
    await _waitForControl();
  }

  Future<void> _stop() async {
    final process = _process;
    if (process == null) return;
    _process = null;
    process.kill(ProcessSignal.sigterm);
    await process.exitCode.timeout(
      const Duration(seconds: 3),
      onTimeout: () {
        process.kill(ProcessSignal.sigkill);
        return -1;
      },
    );
  }

  Future<Map<String, Object?>> _ask(Map<String, Object?> request) async {
    final reply = await _request(request);
    if (reply is! Map) {
      throw StateError('$request answered $reply');
    }
    return Map<String, Object?>.from(reply);
  }

  Future<Object?> _request(Map<String, Object?> request) async {
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

  Future<void> _waitForControl() async {
    final deadline = DateTime.now().add(const Duration(seconds: 30));
    while (true) {
      try {
        await status();
        return;
      } on Object {
        if (DateTime.now().isAfter(deadline)) {
          throw StateError(
            'the daemon never answered on $controlSocket:\n${_log.join('\n')}',
          );
        }
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
    }
  }

  void _record(String line) {
    _log.add(line);
    if (_log.length > 100) {
      _log.removeAt(0);
    }
  }
}
