@Tags(['e2e'])
library;

import 'dart:math';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'fake_bridge.dart';
import 'link_sandbox.dart';
import 'pairing_flows.dart';

/// Five message indexes a redial is forced on, spread over the stream.
Set<int> _redialPoints(int total, int count) {
  final random = Random(7);
  final points = <int>{};
  while (points.length < count) {
    points.add(1 + random.nextInt(total - 2));
  }
  return points;
}

void main() {
  test(
    'resumes across five redials without losing or repeating a message',
    () async {
      final sandbox = await LinkSandbox.create();
      final bridge = await FakeBridge.start(sandbox.bridgeSocket);
      addTearDown(bridge.close);
      await sandbox.startDaemon();

      final phone = (await pairOverLan(sandbox, LinkIdentity.generate())).phone;
      const total = 200;
      final redials = _redialPoints(total, 5);

      for (var index = 0; index < total; index++) {
        phone.sendBridge('m$index');
        if (!redials.contains(index)) {
          continue;
        }
        final from = phone.statusCount;
        phone.networkChanged();
        final resumed = await phone.awaitStatus(
          (status) =>
              status.state == LinkConnectionState.connected &&
              status.resumed == true,
          from: from,
          reason: 'a resumed handshake after the redial at m$index',
        );
        expect(resumed.route, LinkRoute.lan);
      }

      final deadline = DateTime.now().add(const Duration(seconds: 60));
      while (phone.bridge.length < total && DateTime.now().isBefore(deadline)) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }

      expect(phone.bridge, <String>[
        for (var index = 0; index < total; index++) 'echo:m$index',
      ], reason: 'every message came back exactly once, in order');
      expect(bridge.received.length, total);
      expect(bridge.connectionCount, 1, reason: 'one bridge socket held');
    },
    timeout: const Timeout(Duration(seconds: 300)),
  );
}
