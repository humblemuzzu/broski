import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'bridge_session.dart';
import 'lan_forwarder.dart';
import 'link_phone.dart';
import 'link_sandbox.dart';
import 'pairing_flows.dart';
import 'real_bridge.dart';

/// A machine running the repo's real Bun bridge, with a paired phone.
typedef Machine = ({
  LinkSandbox sandbox,
  RealBridge bridge,
  LinkPhone phone,
  BridgeSession session,
  String deviceId,
  LanForwarder? forwarder,
});

/// Starts a sandbox whose daemon supervises the real bridge, pairs a phone over
/// the LAN, and hands back both halves.
///
/// [prepare] runs on the fresh sandbox before anything starts, for tests that
/// need files in the bridge's own home. With [pausable] the phone reaches the
/// daemon through a [LanForwarder], so a test can stop it reading the way a
/// phone that stalls would.
Future<Machine> startMachine({
  Future<void> Function(LinkSandbox sandbox)? prepare,
  bool pausable = false,
}) async {
  final sandbox = await LinkSandbox.create();
  if (prepare != null) {
    await prepare(sandbox);
  }
  final environment = sandboxEnvironment(sandbox);
  await sandbox.startDaemon(
    bridgeCmd: await realBridgeCommand(),
    environment: environment,
  );
  final bridge = await RealBridge.up(sandbox);
  final forwarder = pausable
      ? await LanForwarder.start(sandbox.lanPort!)
      : null;
  if (forwarder != null) {
    addTearDown(forwarder.close);
  }

  final identity = LinkIdentity.generate();
  final paired = await pairOverLan(
    sandbox,
    identity,
    candidate: forwarder?.candidate,
  );
  final session = BridgeSession(paired.phone);
  addTearDown(session.dispose);
  return (
    sandbox: sandbox,
    bridge: bridge,
    phone: paired.phone,
    session: session,
    deviceId: identity.id,
    forwarder: forwarder,
  );
}

/// Every device id the bridge currently reports.
Future<List<String>> bridgeDeviceIds(BridgeSession session) async {
  final reply = await session.request(listDevices(session.key()));
  expect(reply['type'], 'devices');
  final data = reply['data'] as List<Object?>;
  return <String>[
    for (final device in data)
      if (device is Map && device['deviceId'] is String)
        device['deviceId'] as String,
  ];
}

/// Fails when the phone saw the link session replaced or closed under it.
void expectLinkSurvived(LinkPhone phone) {
  expect(
    phone.statuses.where((status) => status.sessionReset),
    isEmpty,
    reason: 'the link session outlived the transcript',
  );
  expect(
    phone.statuses.where((status) => status.closeCode != null),
    isEmpty,
    reason: 'the daemon never closed the session',
  );
  expect(phone.sendFailures, isEmpty, reason: 'the link refused nothing');
}
