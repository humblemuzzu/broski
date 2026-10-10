import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'fake_machine.dart';
import 'harness.dart';
import 'wait_for.dart';

void main() {
  late FakeMachine machine;

  setUp(() async {
    machine = await FakeMachine.start();
    addTearDown(machine.close);
  });

  test('a relay socket waits for online before it sends msg1', () async {
    await startHarness(machine);
    await machine.relayUpgraded;

    expect(machine.relayRequests, 1);
    expect(
      machine.relayHeaders.single,
      containsPair('x-broski-machine', 'machine-1'),
    );
    expect(
      machine.relayHeaders.single,
      containsPair('x-broski-device', 'device-1'),
    );
    expect(
      machine.relayHeaders.single,
      containsPair('authorization', 'Bearer token'),
    );

    await Future<void>.delayed(const Duration(milliseconds: 300));
    expect(machine.relayFrames, isEmpty, reason: 'no status was sent yet');

    machine.sendRelayStatus('online');
    expect((await machine.nextRelayFrame()).length, 3576);
  });

  test(
    'offline reports machineOffline, keeps the socket and sends nothing',
    () async {
      final harness = await startHarness(machine);
      await machine.relayUpgraded;

      machine.sendRelayStatus('offline', lastSeen: 1700000000000);
      final status = await waitForStatus(
        harness,
        (status) => status.state == LinkConnectionState.machineOffline,
      );
      expect(status.route, LinkRoute.relay);
      expect(status.routeDetail, '127.0.0.1');
      expect(
        status.lastSeen,
        DateTime.fromMillisecondsSinceEpoch(1700000000000),
      );

      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(machine.relayFrames, isEmpty);
      expect(
        machine.relayOpen,
        isTrue,
        reason: 'the socket learns when the machine is back',
      );

      machine.sendRelayStatus('online');
      expect((await machine.nextRelayFrame()).length, 3576);
    },
  );

  test('asleep reports machineAsleep and sends nothing', () async {
    final harness = await startHarness(machine);
    await machine.relayUpgraded;

    machine.sendRelayStatus('asleep');
    final status = await waitForStatus(
      harness,
      (status) => status.state == LinkConnectionState.machineAsleep,
    );
    expect(status.route, LinkRoute.relay);

    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(machine.relayFrames, isEmpty);
  });

  test('an unauthorised upgrade is retried after a backoff', () async {
    machine.rejectRelay = true;
    final harness = await startHarness(machine);

    await waitForStatus(
      harness,
      (status) => status.state == LinkConnectionState.waiting,
    );
    expect(machine.relayRequests, 1);
    final mark = harness.statuses.length;

    await waitFor(
      () => machine.relayRequests >= 2,
      reason: 'a second dial after the backoff',
    );
    expect(
      harness.statuses
          .skip(mark)
          .any((status) => status.state == LinkConnectionState.connecting),
      isTrue,
    );
  });
}
