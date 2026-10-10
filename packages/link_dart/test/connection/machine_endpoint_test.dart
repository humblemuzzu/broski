import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';
import 'package:broski_link/src/connection/machine_endpoint.dart';
import 'package:test/test.dart';

MachineEndpoint endpoint({String? relay, String? token = 'token'}) =>
    MachineEndpoint(
      machineId: 'machine-1',
      serverPublicBundle: Uint8List(publicBundleLength),
      deviceId: 'device-1',
      lan: const <String>['192.168.1.5:7331'],
      relay: relay == null ? null : Uri.parse(relay),
      relayToken: token,
    );

void main() {
  test('a LAN candidate is plain ws on its own host:port', () {
    expect(
      endpoint().lanLink('10.0.0.4:99'),
      Uri.parse('ws://10.0.0.4:99/v1/link'),
    );
  });

  test('the relay device socket replaces the base path and keeps the port', () {
    expect(
      endpoint(relay: 'wss://relay.example/prefix?x=1').relayDevice(),
      Uri.parse('wss://relay.example/v1/device'),
    );
    expect(
      endpoint(relay: 'wss://relay.example:8443').relayDevice(),
      Uri.parse('wss://relay.example:8443/v1/device'),
    );
  });

  test('plaintext ws is only allowed towards loopback or private hosts', () {
    expect(
      endpoint(relay: 'ws://127.0.0.1:8080').relayDevice(),
      Uri.parse('ws://127.0.0.1:8080/v1/device'),
    );
    expect(endpoint(relay: 'ws://[::1]:8080').relayDevice(), isNotNull);
    expect(endpoint(relay: 'wss://93.184.216.34').relayDevice(), isNotNull);
    expect(
      () => endpoint(relay: 'ws://relay.example').relayDevice(),
      throwsArgumentError,
    );
    expect(
      () => endpoint(relay: 'ws://93.184.216.34').relayDevice(),
      throwsArgumentError,
    );
    expect(
      () => endpoint(relay: 'https://relay.example').relayDevice(),
      throwsArgumentError,
    );
  });

  test('a relay without a bearer token is no relay route', () {
    expect(endpoint(relay: null).relayDevice(), isNull);
    expect(
      endpoint(relay: 'wss://relay.example', token: null).relayDevice(),
      isNull,
    );
    expect(
      () => endpoint(relay: 'wss://relay.example', token: null).relayHeaders(),
      throwsStateError,
    );
  });

  test('relay headers carry both ids and the bearer token', () {
    expect(
      endpoint(relay: 'wss://relay.example').relayHeaders(),
      <String, String>{
        'x-broski-machine': 'machine-1',
        'x-broski-device': 'device-1',
        'authorization': 'Bearer token',
      },
    );
  });

  test('loopback, private and CGNAT hosts are recognised', () {
    for (final host in <String>[
      'localhost',
      'mac.local',
      '127.0.0.1',
      '::1',
      '10.1.2.3',
      '192.168.0.9',
      '172.16.0.1',
      '172.31.255.1',
      '100.101.102.103',
      'fd00::1',
      'fe80::1',
    ]) {
      expect(isLoopbackOrPrivateHost(host), isTrue, reason: host);
    }
    for (final host in <String>[
      'relay.example',
      '8.8.8.8',
      '172.32.0.1',
      '100.128.0.1',
      '2a00:1450::1',
      'fe00::1',
    ]) {
      expect(isLoopbackOrPrivateHost(host), isFalse, reason: host);
    }
  });
}
