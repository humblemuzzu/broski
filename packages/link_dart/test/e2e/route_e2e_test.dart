@Tags(['e2e'])
library;

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'fake_bridge.dart';
import 'lan_forwarder.dart';
import 'link_phone.dart';
import 'link_sandbox.dart';
import 'pairing_flows.dart';

const Timeout _budget = Timeout(Duration(seconds: 300));
const int _streamed = 40;

/// Sends [count] numbered messages and waits for every echo.
Future<void> _roundTrips(LinkPhone phone, String prefix, int count) async {
  for (var index = 0; index < count; index++) {
    await phone.roundTrip('$prefix$index');
  }
}

/// Pushes [count] numbered messages without waiting for their echoes.
void _sendAll(LinkPhone phone, String prefix, int count) {
  for (var index = 0; index < count; index++) {
    phone.sendBridge('$prefix$index');
  }
}

/// Waits for [count] echoes of [prefix]'s messages, in order.
Future<void> _echoes(LinkPhone phone, String prefix, int count) async {
  for (var index = 0; index < count; index++) {
    expect(await phone.nextBridge(), 'echo:$prefix$index');
  }
}

/// Streams over the LAN, cuts it, and asserts the session lands on the relay
/// with every message echoed exactly once and in order.
Future<void> _moveToRelay(LinkPhone phone, LanForwarder forwarder) async {
  await _roundTrips(phone, 'before', _streamed);
  final from = phone.statusCount;
  forwarder.cut();
  _sendAll(phone, 'after', _streamed);

  final failover = await _awaitRoute(
    phone,
    LinkRoute.relay,
    from: from,
    reason: 'the session moves onto the relay route',
  );
  expect(failover.resumed, isTrue, reason: 'the session resumed');
  await _echoes(phone, 'after', _streamed);
  expect(phone.bridge, <String>[
    for (var index = 0; index < _streamed; index++) 'echo:before$index',
    for (var index = 0; index < _streamed; index++) 'echo:after$index',
  ], reason: 'nothing was lost and nothing arrived twice');
}

Future<LinkStatus> _awaitRoute(
  LinkPhone phone,
  LinkRoute route, {
  int from = 0,
  Duration timeout = const Duration(seconds: 20),
  String? reason,
}) => phone.awaitStatus(
  (status) =>
      status.state == LinkConnectionState.connected && status.route == route,
  from: from,
  timeout: timeout,
  reason: reason,
);

void main() {
  test(
    'moves from LAN to the relay and back without losing a message',
    () async {
      final sandbox = await LinkSandbox.create();
      final bridge = await FakeBridge.start(sandbox.bridgeSocket);
      addTearDown(bridge.close);
      final relay = await sandbox.startRelay();
      await sandbox.startDaemon(relay: true);
      final forwarder = await LanForwarder.start(sandbox.lanPort!);
      addTearDown(forwarder.close);

      final identity = LinkIdentity.generate();
      final paired = await pairOverLan(
        sandbox,
        identity,
        candidate: forwarder.candidate,
      );
      final phone = paired.phone;
      expect(paired.connected.route, LinkRoute.lan);

      MachineEndpoint endpoint(List<String> lan) => MachineEndpoint(
        machineId: paired.machineId,
        serverPublicBundle: paired.bundle,
        deviceId: identity.id,
        lan: lan,
        relay: relay,
        relayToken: paired.token,
      );

      phone.updateEndpoint(endpoint(<String>[forwarder.candidate]));
      await _moveToRelay(phone, forwarder);

      forwarder.restore();
      phone.updateEndpoint(endpoint(<String>[forwarder.candidate]));
      final migrated = await _awaitRoute(
        phone,
        LinkRoute.lan,
        from: phone.statusCount,
        timeout: const Duration(seconds: 40),
        reason: 'the 15 s LAN probe wins the route back',
      );
      expect(migrated.resumed, isTrue);
      expect(migrated.routeDetail, forwarder.candidate);

      phone.sendBridge('home');
      expect(await phone.nextBridge(), 'echo:home');
    },
    timeout: _budget,
  );

  test(
    'a relay-only phone takes the LAN route the machine announces',
    () async {
      final sandbox = await LinkSandbox.create();
      final bridge = await FakeBridge.start(sandbox.bridgeSocket);
      addTearDown(bridge.close);
      final relay = await sandbox.startRelay();
      await sandbox.startDaemon(relay: true);

      final identity = LinkIdentity.generate();
      final paired = await pairOverRelay(sandbox, identity);
      paired.phone.sendBridge('relay');
      expect(await paired.phone.nextBridge(), 'echo:relay');

      final from = paired.phone.statusCount;
      paired.phone.updateEndpoint(
        MachineEndpoint(
          machineId: paired.machineId,
          serverPublicBundle: paired.bundle,
          deviceId: identity.id,
          lan: <String>[sandbox.lanCandidate],
          relay: relay,
          relayToken: paired.token,
        ),
      );

      final lan = await _awaitRoute(
        paired.phone,
        LinkRoute.lan,
        from: from,
        timeout: const Duration(seconds: 40),
        reason: 'the announced LAN candidate is probed and takes over',
      );
      expect(lan.routeDetail, sandbox.lanCandidate);

      paired.phone.sendBridge('lan');
      expect(await paired.phone.nextBridge(), 'echo:lan');
    },
    timeout: _budget,
  );

  test(
    'a restarted machine reports offline, resets the session and reconnects',
    () async {
      final sandbox = await LinkSandbox.create();
      final bridge = await FakeBridge.start(sandbox.bridgeSocket);
      addTearDown(bridge.close);
      await sandbox.startRelay();
      await sandbox.startDaemon(lan: false, relay: true);

      final paired = await pairOverRelay(sandbox, LinkIdentity.generate());
      paired.phone.sendBridge('asleep');
      expect(await paired.phone.nextBridge(), 'echo:asleep');
      final from = paired.phone.statusCount;
      await sandbox.killDaemon();

      final offline = await paired.phone.awaitStatus(
        (status) => status.state == LinkConnectionState.machineOffline,
        from: from,
        timeout: const Duration(seconds: 50),
        reason: 'the relay reports the machine offline',
      );
      expect(offline.route, LinkRoute.relay);

      await sandbox.startDaemon(lan: false, relay: true);
      final reset = await paired.phone.awaitStatus(
        (status) =>
            status.state == LinkConnectionState.connected &&
            status.sessionReset,
        from: from,
        timeout: const Duration(seconds: 60),
        reason: 'the phone reconnects to the restarted machine',
      );
      expect(
        reset.resumed,
        isFalse,
        reason: 'the restarted machine starts a fresh session',
      );

      paired.phone.sendBridge('awake');
      expect(await paired.phone.nextBridge(), 'echo:awake');
      expect(bridge.connectionCount, greaterThanOrEqualTo(2));
    },
    timeout: _budget,
  );
}
