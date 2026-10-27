import 'package:broski/models/link/machine.dart';
import 'package:broski/services/link/device_identity_store.dart';
import 'package:broski/services/link/machine_store.dart';
import 'package:broski/services/storage/broski_secure_storage.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../link/link_fixtures.dart';

/// Records every operation with the options it carried, so a write and its
/// delete can be compared rather than assumed equal.
class _RecordingPlatform extends FlutterSecureStoragePlatform {
  final Map<String, String> data = <String, String>{};
  final List<({String op, String key, Map<String, String> options})> calls = [];

  List<({String op, String key, Map<String, String> options})> of(String op) =>
      [
        for (final call in calls)
          if (call.op == op) call,
      ];

  void record(String op, String key, Map<String, String> options) =>
      calls.add((op: op, key: key, options: options));

  @override
  Future<void> write({
    required String key,
    required String value,
    required Map<String, String> options,
  }) async {
    record('write', key, options);
    data[key] = value;
  }

  @override
  Future<String?> read({
    required String key,
    required Map<String, String> options,
  }) async {
    record('read', key, options);
    return data[key];
  }

  @override
  Future<bool> containsKey({
    required String key,
    required Map<String, String> options,
  }) async {
    record('contains', key, options);
    return data.containsKey(key);
  }

  @override
  Future<void> delete({
    required String key,
    required Map<String, String> options,
  }) async {
    record('delete', key, options);
    data.remove(key);
  }

  @override
  Future<Map<String, String>> readAll({
    required Map<String, String> options,
  }) async {
    record('readAll', '', options);
    return Map.of(data);
  }

  @override
  Future<void> deleteAll({required Map<String, String> options}) async {
    record('deleteAll', '', options);
    data.clear();
  }
}

Machine _machine() => Machine(
  id: '0123456789abcdef0123456789abcdef',
  name: 'MacBook Pro',
  os: 'macOS 26',
  publicBundle: patternBytes(1217, seed: 1),
  fingerprint: patternBytes(32, seed: 1),
  relay: Uri.parse('wss://relay.example/machine'),
  lan: const ['10.0.0.7:8765'],
  relayToken: 'relay-token-1',
  pairedAt: DateTime.utc(2026, 1, 1),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _RecordingPlatform platform;

  setUp(() {
    platform = _RecordingPlatform();
    FlutterSecureStoragePlatform.instance = platform;
  });

  test('every Broski secret uses one app-private store', () {
    expect(
      broskiSecureStorage.aOptions.toMap(),
      containsPair('encryptedSharedPreferences', 'true'),
    );
    expect(
      broskiSecureStorage.iOptions.toMap(),
      containsPair('accessibility', 'first_unlock_this_device'),
    );
  });

  test(
    'the device identity and the machine records share that store',
    () async {
      final identity = await DeviceIdentityStore().load();
      await MachineStore(StorageService()).upsert(_machine());

      expect(identity.id, hasLength(32));
      expect(platform.data.keys, contains('broski_link_device_identity'));
      expect(
        platform.data.keys,
        contains('broski_link_machine_${_machine().id}'),
      );
    },
  );

  test('a machine is deleted from the store it was written to', () async {
    final store = MachineStore(StorageService());
    await store.upsert(_machine());
    expect(
      platform.data.containsKey('broski_link_machine_${_machine().id}'),
      isTrue,
    );

    await store.remove(_machine().id);

    expect(
      platform.data.containsKey('broski_link_machine_${_machine().id}'),
      isFalse,
    );
    expect(
      platform.of('delete').map((call) => call.key),
      contains('broski_link_machine_${_machine().id}'),
    );
  });

  test('a write and its delete carry the same storage options', () async {
    final store = MachineStore(StorageService());
    await store.upsert(_machine());
    await store.remove(_machine().id);

    final key = 'broski_link_machine_${_machine().id}';
    final written = platform.of('write').firstWhere((call) => call.key == key);
    final deleted = platform.of('delete').firstWhere((call) => call.key == key);
    expect(deleted.options, written.options);
  });
}
