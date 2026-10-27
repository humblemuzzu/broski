import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

LinkClient newClient() => LinkClient(
  identity: LinkIdentity.generate(),
  serverBundle: Uint8List(publicBundleLength)..[0] = 1,
);

void main() {
  test('connect produces a msg1 of the expected size', () {
    final client = newClient();
    final msg1 = client.connect(nowMs: 1000);
    expect(msg1.length, 3576, reason: '3570-byte msg1 plus a 6-byte Hello');
    expect(client.pollTransmit(), isNull, reason: 'never connected');
    expect(client.pollEvent(), isNull);
    expect(client.pollTimeout(), isNull, reason: 'not attached yet');
  });

  test('Pair mode sends the same sized msg1', () {
    final client = newClient();
    final msg1 = client.connect(pairingSecret: Uint8List(32), nowMs: 1000);
    expect(msg1.length, 3576);
  });

  test('garbage from the wire is a typed error', () {
    final client = newClient();
    client.connect(nowMs: 0);
    expect(
      () => client.handle(Uint8List.fromList(List.filled(64, 0xab)), nowMs: 0),
      throwsA(isA<LinkProtocolException>()),
    );
    expect(
      () => client.send(1, Uint8List.fromList([1, 2, 3]), nowMs: 0),
      throwsA(isA<LinkNotReadyException>()),
      reason: 'no session before the handshake finishes',
    );
  });

  test('rejects a pairing secret that is not 32 bytes', () {
    final client = newClient();
    expect(
      () => client.connect(pairingSecret: Uint8List(5), nowMs: 0),
      throwsArgumentError,
    );
  });

  test('rejects a server bundle that is not 1217 bytes', () {
    expect(
      () => LinkClient(
        identity: LinkIdentity.generate(),
        serverBundle: Uint8List(10),
      ),
      throwsArgumentError,
    );
  });

  test('disconnect and handleTimeout are safe before and after a connect', () {
    final client = newClient();
    client.handleTimeout(10);
    client.disconnect();
    client.connect(nowMs: 20);
    expect(client.pollTimeout(), isNull);
    client.disconnect();
    expect(client.pollTransmit(), isNull);
  });
}
