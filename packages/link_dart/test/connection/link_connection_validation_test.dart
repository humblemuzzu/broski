import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'harness.dart';

MachineEndpoint endpoint({String? relay = 'wss://relay.example'}) =>
    MachineEndpoint(
      machineId: 'machine-1',
      serverPublicBundle: fakeBundle(),
      deviceId: 'device-1',
      lan: const <String>['192.168.1.5:7331'],
      relay: relay == null ? null : Uri.parse(relay),
      relayToken: 'token',
    );

void main() {
  test('an identity secret of the wrong length is refused', () async {
    expect(
      () => LinkConnection.start(
        identitySecret: Uint8List(10),
        endpoint: endpoint(),
      ),
      throwsArgumentError,
    );
  });

  test('a bundle of the wrong length is refused', () async {
    expect(
      () => LinkConnection.start(
        identitySecret: LinkIdentity.generate().secret,
        endpoint: MachineEndpoint(
          machineId: 'machine-1',
          serverPublicBundle: Uint8List(10),
          deviceId: 'device-1',
        ),
      ),
      throwsArgumentError,
    );
  });

  test('a pairing secret that is not 32 bytes is refused', () async {
    expect(
      () => LinkConnection.start(
        identitySecret: LinkIdentity.generate().secret,
        endpoint: endpoint(),
        pairingSecret: Uint8List(4),
      ),
      throwsArgumentError,
    );
  });

  test(
    'a cleartext relay off loopback is refused before the isolate spawns',
    () async {
      expect(
        () => LinkConnection.start(
          identitySecret: LinkIdentity.generate().secret,
          endpoint: endpoint(relay: 'ws://relay.example'),
        ),
        throwsArgumentError,
      );
    },
  );
}
