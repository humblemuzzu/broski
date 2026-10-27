import 'dart:io';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'fake_machine.dart';
import 'harness.dart';

/// The endpoint a phone builds for [machine], with [lan] as its candidates.
MachineEndpoint endpointFor(
  FakeMachine machine, {
  List<String> lan = const [],
  bool relay = true,
}) => MachineEndpoint(
  machineId: 'machine-1',
  serverPublicBundle: fakeBundle(),
  deviceId: 'device-1',
  lan: lan,
  relay: relay ? machine.relayUri : null,
  relayToken: relay ? 'token' : null,
);

void main() {
  late FakeMachine machine;

  setUp(() async {
    machine = await FakeMachine.start();
    addTearDown(machine.close);
  });

  test('a new route abandons a dial that is going nowhere', () async {
    final silent = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(silent.close);

    final harness = await startHarness(
      machine,
      lan: <String>['127.0.0.1:${silent.port}'],
      relay: false,
    );
    await waitForStatus(
      harness,
      (status) => status.state == LinkConnectionState.connecting,
    );

    harness.connection.updateEndpoint(
      endpointFor(machine, lan: <String>[machine.candidate], relay: false),
    );

    await machine.lanUpgraded.timeout(
      const Duration(seconds: 2),
      onTimeout: () => fail('the link waited out the dial it had given up on'),
    );
  });

  test('a new route reaches a link parked by the relay', () async {
    final harness = await startHarness(machine);
    await machine.relayUpgraded;

    machine.sendRelayStatus('offline');
    await waitForStatus(
      harness,
      (status) => status.state == LinkConnectionState.machineOffline,
    );
    expect(machine.lan, isNull, reason: 'a parked link dials nothing');

    harness.connection.updateEndpoint(
      endpointFor(machine, lan: <String>[machine.candidate]),
    );

    await machine.lanUpgraded.timeout(
      const Duration(seconds: 3),
      onTimeout: () => fail('the new LAN candidate was never dialled'),
    );
    expect(await machine.nextLanFrame(), hasLength(3576));
  });
}
