@Tags(['e2e'])
library;

import 'dart:io';
import 'dart:math';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'fake_bridge.dart';
import 'link_phone.dart';
import 'link_sandbox.dart';
import 'pairing_flows.dart';

const Timeout _budget = Timeout(Duration(seconds: 300));

const int _roundTrips = 500;
const int _roundTripBytes = 200;
const int _bulkMessages = 50;
const int _bulkBytes = 64 * 1024;

/// Printable ASCII, so every frame is a valid text frame on the bridge socket.
String _text(int bytes, int seed) {
  final random = Random(seed);
  final buffer = StringBuffer();
  while (buffer.length < bytes) {
    buffer.writeCharCode(33 + random.nextInt(94));
  }
  return buffer.toString();
}

/// Milliseconds at [fraction] of the sorted [microseconds].
double _percentile(List<int> microseconds, double fraction) =>
    microseconds[((microseconds.length - 1) * fraction).round()] / 1000;

Future<void> _measure(String label, LinkPhone phone) async {
  final payload = _text(_roundTripBytes, 1);
  final latencies = <int>[];
  for (var index = 0; index < _roundTrips; index++) {
    latencies.add((await phone.roundTrip(payload)).inMicroseconds);
  }
  latencies.sort();

  final bulk = _text(_bulkBytes, 2);
  final watch = Stopwatch()..start();
  for (var index = 0; index < _bulkMessages; index++) {
    phone.sendBridge(bulk);
  }
  for (var index = 0; index < _bulkMessages; index++) {
    await phone.nextBridge(timeout: const Duration(seconds: 60));
  }
  watch.stop();
  const megabytes = _bulkMessages * _bulkBytes / (1024 * 1024);
  final throughput = megabytes / (watch.elapsedMicroseconds / 1000000);

  final p50 = _percentile(latencies, 0.5);
  final p99 = _percentile(latencies, 0.99);
  stdout.writeln(
    'perf[$label] '
    '$_roundTrips x $_roundTripBytes B: p50 ${p50.toStringAsFixed(2)} ms, '
    'p99 ${p99.toStringAsFixed(2)} ms, '
    'min ${latencies.first / 1000} ms, max ${latencies.last / 1000} ms; '
    '$_bulkMessages x 64 KiB: ${throughput.toStringAsFixed(1)} MB/s '
    'over ${watch.elapsedMilliseconds} ms',
  );

  expect(p50, lessThan(200), reason: 'LAN and relay p50 are milliseconds');
  expect(p99, lessThan(1000));
  expect(throughput, greaterThan(1));
}

void main() {
  test('measures round trips and throughput over the LAN', () async {
    final sandbox = await LinkSandbox.create();
    final bridge = await FakeBridge.start(sandbox.bridgeSocket);
    addTearDown(bridge.close);
    await sandbox.startDaemon();

    final paired = await pairOverLan(sandbox, LinkIdentity.generate());
    expect(paired.connected.route, LinkRoute.lan);
    await _measure('lan', paired.phone);
  }, timeout: _budget);

  test('measures round trips and throughput over the relay', () async {
    final sandbox = await LinkSandbox.create();
    final bridge = await FakeBridge.start(sandbox.bridgeSocket);
    addTearDown(bridge.close);
    await sandbox.startRelay();
    await sandbox.startDaemon(lan: false, relay: true);

    final paired = await pairOverRelay(sandbox, LinkIdentity.generate());
    expect(paired.connected.route, LinkRoute.relay);
    await _measure('relay', paired.phone);
  }, timeout: _budget);
}
