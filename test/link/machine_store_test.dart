import 'dart:collection';
import 'dart:convert';

import 'package:broski/models/link/machine.dart';
import 'package:broski/services/link/machine_store.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'link_fixtures.dart';

const _idsKey = 'broski_link_machine_ids';
const _legacyKey = 'broski_link_machines';

String machineKey(String id) => 'broski_link_machine_$id';

Machine machineAt(int index) => Machine(
  id: index.toRadixString(16).padLeft(32, '0'),
  name: 'Machine $index',
  os: 'macOS 15.3',
  publicBundle: patternBytes(1217, seed: index),
  fingerprint: patternBytes(32, seed: index),
  relay: Uri.parse('wss://relay.example/$index'),
  lan: ['10.0.0.$index:8765'],
  relayToken: 'relay-token-$index',
  pairedAt: DateTime.utc(2026, 1, 1).add(Duration(days: index)),
);

List<String> idsOf(List<Machine> machines) => [
  for (final machine in machines) machine.id,
];

/// The secure-storage mock writes into the map it is handed, so this records
/// exactly which keys an operation rewrites or removes.
class RecordingStorage extends MapBase<String, String> {
  RecordingStorage(this._data);

  final Map<String, String> _data;
  final List<String> written = [];
  final List<String> deleted = [];

  void record() {
    written.clear();
    deleted.clear();
  }

  @override
  Iterable<String> get keys => _data.keys;

  @override
  String? operator [](Object? key) => _data[key];

  @override
  void operator []=(String key, String value) {
    written.add(key);
    _data[key] = value;
  }

  @override
  void clear() {
    deleted.addAll(_data.keys);
    _data.clear();
  }

  @override
  String? remove(Object? key) {
    deleted.add(key as String);
    return _data.remove(key);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late RecordingStorage storage;

  setUp(() {
    storage = RecordingStorage(<String, String>{});
    FlutterSecureStorage.setMockInitialValues(storage);
  });

  test('roundtrips ten machines in order', () async {
    final machines = [
      for (var index = 0; index < 10; index++) machineAt(index),
    ];

    await MachineStore(StorageService()).save(machines);
    final loaded = await MachineStore(StorageService()).load();

    expect(loaded.map((machine) => machine.id), idsOf(machines));
    expect(loaded[3].name, 'Machine 3');
    expect(loaded[3].publicBundle, machines[3].publicBundle);
    expect(loaded[3].relayToken, machines[3].relayToken);
    expect(jsonDecode(storage[_idsKey]!), idsOf(machines));
  });

  test('saving a machine writes its own item', () async {
    final machines = [for (var index = 0; index < 3; index++) machineAt(index)];

    await MachineStore(StorageService()).save(machines);

    expect(storage.containsKey(machineKey(machines[1].id)), isTrue);
    expect(storage.containsKey(_legacyKey), isFalse);
  });

  test('save replaces the list and drops the old machine items', () async {
    final store = MachineStore(StorageService());
    await store.save([machineAt(0), machineAt(1), machineAt(2)]);
    storage.record();

    await store.save([machineAt(0)]);

    expect(storage.deleted, [
      machineKey(machineAt(1).id),
      machineKey(machineAt(2).id),
    ]);
    expect(storage.containsKey(machineKey(machineAt(1).id)), isFalse);
    expect((await store.load()).map((machine) => machine.id), [
      machineAt(0).id,
    ]);
  });

  test('upsert rewrites only the machine it changes', () async {
    final machines = [for (var index = 0; index < 5; index++) machineAt(index)];
    final store = MachineStore(StorageService());
    await store.save(machines);
    storage.record();

    final changed = machines[2].copyWith(lan: const ['10.0.0.99:8765']);
    final after = await store.upsert(changed);

    expect(storage.written, [machineKey(machines[2].id), _idsKey]);
    expect(storage.deleted, isEmpty);
    expect(after.map((machine) => machine.id), idsOf(machines));
    expect((await store.load())[2].lan, ['10.0.0.99:8765']);
  });

  test('upsert adds a new machine at the front', () async {
    final machines = [for (var index = 0; index < 3; index++) machineAt(index)];
    final store = MachineStore(StorageService());
    await store.save(machines);
    storage.record();

    final added = machineAt(9);
    final after = await store.upsert(added);

    expect(after.map((machine) => machine.id), [added.id, ...idsOf(machines)]);
    expect(storage.written, [machineKey(added.id), _idsKey]);
    expect(storage.deleted, isEmpty);
  });

  test('remove deletes only its item', () async {
    final machines = [for (var index = 0; index < 4; index++) machineAt(index)];
    final store = MachineStore(StorageService());
    await store.save(machines);
    storage.record();

    final left = await store.remove(machines[1].id);

    expect(left.map((machine) => machine.id), [
      machines[0].id,
      machines[2].id,
      machines[3].id,
    ]);
    expect(storage.deleted, [machineKey(machines[1].id)]);
    expect(storage.written, [_idsKey]);
    expect(storage.containsKey(machineKey(machines[0].id)), isTrue);
  });

  test('a corrupt or missing machine item is dropped from the index', () async {
    final machines = [for (var index = 0; index < 4; index++) machineAt(index)];
    final store = MachineStore(StorageService());
    await store.save(machines);
    storage[machineKey(machines[1].id)] = '{"id":7}';
    storage.remove(machineKey(machines[2].id));

    final loaded = await store.load();

    expect(loaded.map((machine) => machine.id), [
      machines[0].id,
      machines[3].id,
    ]);
    expect(jsonDecode(storage[_idsKey]!), [machines[0].id, machines[3].id]);
    expect((await store.load()).map((machine) => machine.id), [
      machines[0].id,
      machines[3].id,
    ]);
  });

  test('migrates the legacy single blob and deletes it', () async {
    final machines = [machineAt(0), machineAt(1)];
    storage[_legacyKey] = jsonEncode([
      for (final machine in machines) machine.toJson(),
    ]);

    final loaded = await MachineStore(StorageService()).load();

    expect(loaded.map((machine) => machine.id), idsOf(machines));
    expect(storage.containsKey(_legacyKey), isFalse);
    for (final machine in machines) {
      expect(storage.containsKey(machineKey(machine.id)), isTrue);
    }
    expect(
      (await MachineStore(
        StorageService(),
      ).load()).map((machine) => machine.id),
      idsOf(machines),
    );
  });

  test('an unreadable legacy blob reads as an empty list', () async {
    for (final blob in <String>['not json at all', '[1,2]', '[{"id":7}]']) {
      FlutterSecureStorage.setMockInitialValues({_legacyKey: blob});

      expect(
        await MachineStore(StorageService()).load(),
        isEmpty,
        reason: blob,
      );
    }
  });

  test('no stored value exceeds two kilobytes', () async {
    final machines = [
      for (var index = 0; index < 10; index++) machineAt(index),
    ];

    await MachineStore(StorageService()).save(machines);

    for (final entry in storage.entries) {
      expect(entry.value.length, lessThanOrEqualTo(2048), reason: entry.key);
    }
  });

  test('the selected machine id persists and clears', () async {
    final store = MachineStore(StorageService());

    await store.saveSelectedId(machineAt(0).id);
    expect(
      await MachineStore(StorageService()).loadSelectedId(),
      machineAt(0).id,
    );

    await store.saveSelectedId(null);
    expect(await MachineStore(StorageService()).loadSelectedId(), isNull);
  });
}
