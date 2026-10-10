import 'dart:async';
import 'dart:convert';

import 'package:broski/models/link/machine.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/link/push_providers.dart';
import 'package:broski/services/link/push_key_store.dart';
import 'package:broski/services/link/push_registration.dart';
import 'package:broski/services/link/push_token_source.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'link_fixtures.dart';

const _machineId = '11223344556677889900112233445566';
const _deviceId = 'ffeeddccbbaa99887766554433221100';
const _token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const _relay = 'wss://relay.example/v1/machine';

class FakeTokens implements PushTokens {
  FakeTokens({this.token, this.group = 'group.test'});

  String? token;
  final String? group;
  var registered = 0;

  final StreamController<String> _changes =
      StreamController<String>.broadcast();

  @override
  Future<String?> apnsToken() async => token;

  @override
  Future<String?> keychainGroup() async => group;

  @override
  Future<void> register() async => registered++;

  @override
  Stream<String> get tokenChanges => _changes.stream;

  /// What iOS does when it mints or rotates a device token.
  void deliver(String value) {
    token = value;
    _changes.add(value);
  }
}

Machine machine({
  String? relay = _relay,
  String? relayToken = 'relay-token-1',
}) => Machine(
  id: _machineId,
  name: 'Studio Mac',
  os: 'macos',
  publicBundle: patternBytes(1217, seed: 3),
  fingerprint: patternBytes(32, seed: 3),
  relay: relay == null ? null : Uri.parse(relay),
  lan: const ['10.0.0.2:8765'],
  relayToken: relayToken,
  pairedAt: DateTime.utc(2026),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Map<String, String> keychain;
  late FakeTokens deviceTokens;
  late List<Map<String, Object?>> sent;

  PushRegistration registrationUnder({
    FakeTokens? tokens,
    bool allowed = true,
  }) {
    final source = tokens ?? deviceTokens;
    return PushRegistration(
      tokens: source,
      openStore: () async {
        final group = await source.keychainGroup();
        return group == null ? null : PushKeyStore.forKeychainGroup(group);
      },
      requestPermission: () async => allowed,
    );
  }

  String? storedKey() {
    final raw = keychain[PushKeyStore.itemKey(_machineId)];
    return raw == null ? null : jsonDecode(raw)['key'] as String?;
  }

  setUp(() {
    keychain = <String, String>{};
    FlutterSecureStorage.setMockInitialValues(keychain);
    deviceTokens = FakeTokens(token: _token);
    sent = [];
  });

  test('registers the machine on every Connected', () async {
    final registration = registrationUnder();

    await registration.onConnected(machine(), _deviceId, sent.add);

    expect(sent, hasLength(1));
    expect(sent.single, {
      't': 'push_register',
      'platform': 'apns',
      'token': _token,
      'key': storedKey(),
    });
    expect(pushKeyBytes(storedKey()!), hasLength(32));
    registration.dispose();
  });

  test('one Connected is one registration', () async {
    final registration = registrationUnder();

    await registration.onConnected(machine(), _deviceId, sent.add);
    await registration.onConnected(machine(), _deviceId, sent.add);

    expect(sent, hasLength(2));
    registration.dispose();
  });

  test('a rotated device token is registered again', () async {
    final registration = registrationUnder();

    await registration.onConnected(machine(), _deviceId, sent.add);
    deviceTokens.deliver('cd' * 32);
    await pumpEventQueue();

    expect(sent, hasLength(2));
    expect(sent.last['token'], 'cd' * 32);
    expect(sent.last['key'], storedKey());
    registration.dispose();
  });

  test('a machine without a relay is not registered at all', () async {
    final registration = registrationUnder();

    await registration.onConnected(
      machine(relay: null, relayToken: null),
      _deviceId,
      sent.add,
    );

    expect(sent, isEmpty);
    expect(keychain, isEmpty);
    registration.dispose();
  });

  test('a machine without a relay token is not registered', () async {
    final registration = registrationUnder();

    await registration.onConnected(
      machine(relayToken: null),
      _deviceId,
      sent.add,
    );

    expect(sent, isEmpty);
    expect(keychain, isEmpty);
    registration.dispose();
  });

  test('waits for the device token, then registers once', () async {
    final late = FakeTokens();
    final registration = registrationUnder(tokens: late);

    await registration.onConnected(machine(), _deviceId, sent.add);
    await pumpEventQueue();

    expect(sent, isEmpty);
    expect(late.registered, 1);
    expect(storedKey(), isNotNull);

    late.deliver('cd' * 32);
    await pumpEventQueue();

    expect(sent, [
      {
        't': 'push_register',
        'platform': 'apns',
        'token': 'cd' * 32,
        'key': storedKey(),
      },
    ]);
    registration.dispose();
  });

  test('does not ask for a device token when permission is refused', () async {
    final late = FakeTokens();
    final registration = registrationUnder(tokens: late, allowed: false);

    await registration.onConnected(machine(), _deviceId, sent.add);
    await pumpEventQueue();

    expect(late.registered, 0);
    expect(sent, isEmpty);
    registration.dispose();
  });

  test('nothing is registered against a link that went away', () async {
    final late = FakeTokens();
    final registration = registrationUnder(tokens: late);

    await registration.onConnected(machine(), _deviceId, sent.add);
    registration.detach();
    late.deliver('cd' * 32);
    await pumpEventQueue();

    expect(sent, isEmpty);
    registration.dispose();
  });

  test('forget drops the machine item', () async {
    final registration = registrationUnder();
    await registration.onConnected(machine(), _deviceId, sent.add);

    await registration.forget([_machineId]);

    expect(keychain.containsKey(PushKeyStore.itemKey(_machineId)), isFalse);
    registration.dispose();
  });

  test('a forgotten machine loses its push credentials', () async {
    final container = ProviderContainer(
      overrides: [pushTokensProvider.overrideWithValue(deviceTokens)],
    );
    addTearDown(container.dispose);
    container.read(pushKeyPruneProvider);

    final machines = container.read(machinesProvider.notifier);
    await machines.add(machine());
    await container
        .read(pushRegistrationProvider)
        .onConnected(machine(), _deviceId, sent.add);
    expect(storedKey(), isNotNull);

    await machines.remove(_machineId);
    await pumpEventQueue();

    expect(keychain.containsKey(PushKeyStore.itemKey(_machineId)), isFalse);
  });

  test('the empty machines state the app starts on prunes nothing', () async {
    final registration = registrationUnder();
    await registration.onConnected(machine(), _deviceId, sent.add);
    registration.dispose();

    final container = ProviderContainer(
      overrides: [pushTokensProvider.overrideWithValue(deviceTokens)],
    );
    addTearDown(container.dispose);

    container.read(pushKeyPruneProvider);

    expect(storedKey(), isNotNull);
  });
}
