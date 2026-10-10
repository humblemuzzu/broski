import 'dart:convert';

import 'package:broski/services/link/push_key_store.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

const _machineId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const _deviceId = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Map<String, String> keychain;
  late PushKeyStore store;

  setUp(() {
    keychain = <String, String>{};
    FlutterSecureStorage.setMockInitialValues(keychain);
    store = PushKeyStore(const FlutterSecureStorage());
  });

  Future<MachinePushKey> write({
    String machineId = _machineId,
    String machineName = 'Studio Mac',
    String relay = 'wss://relay.example/v1/machine',
    String relayToken = 'relay-token-1',
  }) => store.write(
    machineId: machineId,
    machineName: machineName,
    relay: Uri.parse(relay),
    deviceId: _deviceId,
    relayToken: relayToken,
  );

  test('writes the item the notification extension reads', () async {
    final item = await write();

    final stored =
        jsonDecode(keychain[PushKeyStore.itemKey(_machineId)]!)
            as Map<String, dynamic>;
    expect(stored, {
      'machine_id': _machineId,
      'machine_name': 'Studio Mac',
      'relay': 'wss://relay.example/v1/machine',
      'device_id': _deviceId,
      'relay_token': 'relay-token-1',
      'key': item.key,
    });
    expect(item.key, isNot(contains('=')));
    expect(pushKeyBytes(item.key), hasLength(32));
  });

  test('keeps the machine key when the machine changes', () async {
    final first = await write();
    final second = await write(
      machineName: 'Studio Mac 2',
      relay: 'wss://other.example/v1/machine',
      relayToken: 'relay-token-2',
    );

    expect(second.key, first.key);
    expect(second.machineName, 'Studio Mac 2');
    expect(second.relayToken, 'relay-token-2');
    final reloaded = await PushKeyStore(
      const FlutterSecureStorage(),
    ).read(_machineId);
    expect(reloaded!.key, first.key);
    expect(reloaded.relay, 'wss://other.example/v1/machine');
  });

  test('every machine gets its own key', () async {
    final first = await write();
    final second = await write(machineId: _deviceId);

    expect(second.key, isNot(first.key));
    expect(pushKeyBytes(second.key), hasLength(32));
  });

  test('a corrupt item reads as absent and is replaced', () async {
    keychain[PushKeyStore.itemKey(_machineId)] = '{"machine_id":7}';
    expect(await store.read(_machineId), isNull);

    final item = await write();

    expect(pushKeyBytes(item.key), hasLength(32));
    expect((await store.read(_machineId))!.key, item.key);
  });

  test('a truncated key reads as absent', () async {
    keychain[PushKeyStore.itemKey(_machineId)] = jsonEncode({
      'machine_id': _machineId,
      'machine_name': 'Studio Mac',
      'relay': 'wss://relay.example/v1/machine',
      'device_id': _deviceId,
      'relay_token': 'relay-token-1',
      'key': 'AAA',
    });

    expect(await store.read(_machineId), isNull);
  });

  test('forget removes only the machines it is given', () async {
    await write();
    await write(machineId: _deviceId);

    await store.forget([_machineId]);

    expect(keychain.containsKey(PushKeyStore.itemKey(_machineId)), isFalse);
    expect(keychain.containsKey(PushKeyStore.itemKey(_deviceId)), isTrue);
  });
}
