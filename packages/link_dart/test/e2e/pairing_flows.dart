import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';

import 'link_phone.dart';
import 'link_sandbox.dart';
import 'pairing_support.dart';

/// A phone paired with a sandbox, with the credentials the machine handed it.
typedef Paired = ({
  LinkPhone phone,
  PairingOffer offer,
  Uint8List bundle,
  String machineId,
  String token,
  Map<String, Object?> confirmation,
  LinkStatus connected,
});

/// Pairs [identity] over the LAN, dialling [candidate] when given instead of
/// the sandbox's own listener.
Future<Paired> pairOverLan(
  LinkSandbox sandbox,
  LinkIdentity identity, {
  String? candidate,
}) async {
  final offer = await sandbox.offer();
  final machineId = machineIdOf(offer.fingerprint);
  final bundle = await fetchBundle(
    'http://${sandbox.lanCandidate}/v1/identity',
    offer.fingerprint,
  );
  final phone = await LinkPhone.start(
    identity: identity,
    endpoint: MachineEndpoint(
      machineId: machineId,
      serverPublicBundle: bundle,
      deviceId: identity.id,
      lan: <String>[candidate ?? sandbox.lanCandidate],
    ),
    pairingSecret: offer.secret,
  );
  final confirmation = await phone.awaitControl('paired');
  final connected = await phone.awaitStatus(
    (status) => status.state == LinkConnectionState.connected,
    reason: 'the paired device connects over the LAN',
  );
  return (
    phone: phone,
    offer: offer,
    bundle: bundle,
    machineId: machineId,
    token: confirmation['relay_token']! as String,
    confirmation: confirmation,
    connected: connected,
  );
}

/// Waits for the relay to serve the machine [offer] names and returns its
/// bundle, checked against the offer's fingerprint.
Future<Uint8List> _relayBundle(Uri relay, PairingOffer offer) async {
  final machineId = machineIdOf(offer.fingerprint);
  const budget = Duration(seconds: 20);
  await awaitRelayIdentity(relay, machineId, budget);
  return fetchBundle(
    'http://${relay.host}:${relay.port}/v1/identity/$machineId',
    offer.fingerprint,
  );
}

/// Opens the relay's pairing channel as the one-time device the offer derives,
/// once the relay authorises it.
Future<LinkPhone> _pairAsDerivedDevice(
  Uri relay,
  PairingOffer offer,
  Uint8List bundle,
  String machineId,
  LinkIdentity identity,
) async {
  final device = pairingDeviceId(offer.secret);
  final credential = pairingToken(offer.secret);
  await awaitRelayDevice(
    relay,
    machineId,
    device,
    credential,
    const Duration(seconds: 20),
  );
  return LinkPhone.start(
    identity: identity,
    endpoint: MachineEndpoint(
      machineId: machineId,
      serverPublicBundle: bundle,
      deviceId: device,
      relay: relay,
      relayToken: credential,
    ),
    pairingSecret: offer.secret,
  );
}

/// Pairs [identity] over the relay as the offer's derived device, then hands
/// the phone its real credentials and waits for it to connect with them.
Future<Paired> pairOverRelay(LinkSandbox sandbox, LinkIdentity identity) async {
  final relay = sandbox.relay!;
  final offer = await sandbox.offer();
  final machineId = machineIdOf(offer.fingerprint);
  final bundle = await _relayBundle(relay, offer);
  final phone = await _pairAsDerivedDevice(
    relay,
    offer,
    bundle,
    machineId,
    identity,
  );
  final confirmation = await phone.awaitControl('paired');
  final token = confirmation['relay_token']! as String;

  final from = phone.statusCount;
  phone.updateEndpoint(
    MachineEndpoint(
      machineId: machineId,
      serverPublicBundle: bundle,
      deviceId: identity.id,
      relay: relay,
      relayToken: token,
    ),
  );
  final connected = await phone.awaitStatus(
    (status) => status.state == LinkConnectionState.connected,
    from: from,
    reason: 'the paired device connects over the relay',
  );
  return (
    phone: phone,
    offer: offer,
    bundle: bundle,
    machineId: machineId,
    token: token,
    confirmation: confirmation,
    connected: connected,
  );
}
