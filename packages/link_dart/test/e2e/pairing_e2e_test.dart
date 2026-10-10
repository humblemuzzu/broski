@Tags(['e2e'])
library;

import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'fake_bridge.dart';
import 'link_phone.dart';
import 'link_sandbox.dart';
import 'pairing_flows.dart';
import 'pairing_support.dart';

const Timeout _budget = Timeout(Duration(seconds: 300));

Map<String, Object?> _machine(Map<String, Object?> paired) {
  final machine = paired['machine'];
  if (machine is! Map) {
    throw StateError('paired without a machine object: $paired');
  }
  return Map<String, Object?>.from(machine);
}

void main() {
  test('pairs over LAN and carries bridge traffic', () async {
    final sandbox = await LinkSandbox.create();
    final bridge = await FakeBridge.start(sandbox.bridgeSocket);
    addTearDown(bridge.close);
    await sandbox.startDaemon();

    final identity = LinkIdentity.generate();
    final paired = await pairOverLan(sandbox, identity);
    final confirmation = paired.confirmation;
    final advertised = (await sandbox.status())['lan'];

    expect(confirmation['device_id'], identity.id);
    expect(_machine(confirmation)['id'], paired.machineId);
    expect(_machine(confirmation)['name'], paired.offer.name);
    expect(_machine(confirmation)['lan'], advertised);
    expect(paired.offer.lan, advertised);
    expect(paired.token.length, 43);
    expect(paired.connected.route, LinkRoute.lan);
    expect(paired.connected.routeDetail, sandbox.lanCandidate);
    expect(paired.connected.resumed, isFalse, reason: 'a pairing is fresh');

    paired.phone.sendControl(<String, Object?>{
      't': 'hello',
      'name': 'e2e phone',
      'platform': 'ios',
    });
    paired.phone.sendBridge('hi');

    expect(await paired.phone.nextBridge(), 'echo:hi');
    expect(bridge.received, <String>['hi']);
    expect(bridge.connectionCount, greaterThanOrEqualTo(1));
    for (var index = 0; index < bridge.connectionCount; index++) {
      expect(bridge.header(index, 'x-broski-device-id'), identity.id);
      expect(bridge.header(index, 'x-broski-role'), 'owner');
    }
    final devices = await sandbox.devices();
    expect((devices.single! as Map)['id'], identity.id);
  }, timeout: _budget);

  test('reconnects in Connect mode with a fresh connection', () async {
    final sandbox = await LinkSandbox.create();
    final bridge = await FakeBridge.start(sandbox.bridgeSocket);
    addTearDown(bridge.close);
    await sandbox.startDaemon();

    final identity = LinkIdentity.generate();
    final paired = await pairOverLan(sandbox, identity);
    await paired.phone.dispose();

    final second = await LinkPhone.start(
      identity: identity,
      endpoint: MachineEndpoint(
        machineId: paired.machineId,
        serverPublicBundle: paired.bundle,
        deviceId: identity.id,
        lan: <String>[sandbox.lanCandidate],
        relayToken: paired.token,
      ),
    );
    final connected = await second.awaitStatus(
      (status) => status.state == LinkConnectionState.connected,
      reason: 'the paired device reconnects in Connect mode',
    );
    expect(connected.route, LinkRoute.lan);
    expect(connected.resumed, isFalse, reason: 'the phone kept no session');

    second.sendBridge('again');
    expect(await second.nextBridge(), 'echo:again');
    expect(bridge.received, <String>['again']);
  }, timeout: _budget);

  test('pairs entirely over the relay and keeps its session', () async {
    final sandbox = await LinkSandbox.create();
    final bridge = await FakeBridge.start(sandbox.bridgeSocket);
    addTearDown(bridge.close);
    final relay = await sandbox.startRelay();
    await sandbox.startDaemon(lan: false, relay: true);

    final pinned = Uint8List.fromList(
      List<int>.generate(32, (int index) => index),
    );
    expect(pairingDeviceId(pinned), '13cf11d39c68f01194167dec02ae299b');
    expect(pairingToken(pinned), 'ftJ9gRzybv0NVMqryTFwpTALY9GjGlZ6a7MD4guui98');

    final identity = LinkIdentity.generate();
    final paired = await pairOverRelay(sandbox, identity);

    expect(paired.offer.relay, relay.toString());
    expect(paired.offer.lan, isEmpty);
    expect(paired.connected.route, LinkRoute.relay);
    expect(paired.connected.resumed, isTrue, reason: 'the session resumed');
    expect(paired.token, isNot(pairingToken(paired.offer.secret)));
    expect(paired.token.length, 43);
    final devices = await sandbox.devices();
    expect((devices.single! as Map)['id'], identity.id);

    paired.phone.sendBridge('relay');
    expect(await paired.phone.nextBridge(), 'echo:relay');
    expect(
      bridge.header(bridge.connectionCount - 1, 'x-broski-device-id'),
      identity.id,
    );
  }, timeout: _budget);

  test('an unknown device never gets a session', () async {
    final sandbox = await LinkSandbox.create();
    final bridge = await FakeBridge.start(sandbox.bridgeSocket);
    addTearDown(bridge.close);
    await sandbox.startDaemon();

    final offer = await sandbox.offer();
    final machineId = machineIdOf(offer.fingerprint);
    final bundle = await fetchBundle(
      'http://${sandbox.lanCandidate}/v1/identity',
      offer.fingerprint,
    );

    final stranger = LinkIdentity.generate();
    final phone = await LinkPhone.start(
      identity: stranger,
      endpoint: MachineEndpoint(
        machineId: machineId,
        serverPublicBundle: bundle,
        deviceId: stranger.id,
        lan: <String>[sandbox.lanCandidate],
      ),
    );

    await Future<void>.delayed(const Duration(seconds: 5));
    expect(
      phone.statuses.where(
        (status) => status.state == LinkConnectionState.connected,
      ),
      isEmpty,
      reason: 'the daemon never answers an unpaired device: ${phone.statuses}',
    );
    expect(bridge.connectionCount, 0);
    expect(phone.bridge, isEmpty);
  }, timeout: _budget);
}
