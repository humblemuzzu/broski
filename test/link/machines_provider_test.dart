import 'dart:convert';
import 'dart:typed_data';

import 'package:broski/models/link/link_control_exception.dart';
import 'package:broski/models/link/machine.dart';
import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/services/link/machine_store.dart';
import 'package:broski/services/storage_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'link_fixtures.dart';

const _machinesKey = 'broski_link_machines';
const _selectedKey = 'broski_link_selected_machine';

Machine fixtureMachine() => Machine(
  id: 'a1' * 16,
  name: 'Studio Mac',
  publicBundle: patternBytes(1217),
  fingerprint: patternBytes(32, seed: 7),
  lan: const [],
  pairedAt: DateTime.utc(2026, 1, 2),
);

Map<String, Object?> pairedMessage({
  required Object? id,
  required Object? name,
  Object? os = 'macOS 15.3',
  Object? relay = 'wss://relay.example/x',
  Object? lan = const ['10.0.0.2:8765'],
  Object? relayToken = 'relay-token-a',
}) => {
  't': 'paired',
  'device_id': 'device-id',
  'relay_token': relayToken,
  'machine': {'id': id, 'name': name, 'os': os, 'relay': relay, 'lan': lan},
};

Future<void> pair(
  ProviderContainer container,
  PendingPairing pending,
  Uint8List publicBundle,
) => container
    .read(machinesProvider.notifier)
    .applyPaired(
      pairedMessage(id: pending.machineId, name: pending.name),
      pending,
      publicBundle,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => FlutterSecureStorage.setMockInitialValues(<String, String>{}));

  test(
    'applyPaired stores the machine the QR pinned and persists it',
    () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final pairing = generatedPairing(
        relay: 'wss://relay.example/x',
        lan: ['10.0.0.2:8765'],
      );

      await container
          .read(machinesProvider.notifier)
          .applyPaired(
            pairedMessage(id: pairing.pending.machineId, name: 'Studio Mac'),
            pairing.pending,
            pairing.publicBundle,
          );
      final state = container.read(machinesProvider);

      expect(state.machines, hasLength(1));
      final machine = state.machines.single;
      expect(machine.id, pairing.pending.machineId);
      expect(machine.name, 'Studio Mac');
      expect(machine.os, 'macOS 15.3');
      expect(machine.relay, Uri.parse('wss://relay.example/x'));
      expect(machine.lan, ['10.0.0.2:8765']);
      expect(machine.relayToken, 'relay-token-a');
      expect(machine.fingerprint, pairing.pending.fingerprint);
      expect(machine.publicBundle, pairing.publicBundle);
      expect(
        machine.pairedAt.difference(DateTime.now()).abs(),
        lessThan(const Duration(minutes: 1)),
      );
      expect(state.selectedId, machine.id);

      final store = MachineStore(StorageService());
      expect((await store.load()).single.id, machine.id);
      expect(await store.loadSelectedId(), machine.id);
    },
  );

  test('a paired message decoded from json is accepted', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final pairing = generatedPairing(relay: null, lan: const []);
    final decoded =
        jsonDecode(
              jsonEncode(
                pairedMessage(
                  id: pairing.pending.machineId,
                  name: 'Studio Mac',
                  relay: null,
                  lan: <String>[],
                ),
              ),
            )
            as Map<String, Object?>;

    await container
        .read(machinesProvider.notifier)
        .applyPaired(decoded, pairing.pending, pairing.publicBundle);

    final machine = container.read(machinesProvider).machines.single;
    expect(machine.id, pairing.pending.machineId);
    expect(machine.relay, isNull);
    expect(machine.lan, isEmpty);
  });

  test('a paired reply from another machine is never stored', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final pairing = generatedPairing();

    await expectLater(
      container
          .read(machinesProvider.notifier)
          .applyPaired(
            pairedMessage(id: 'f' * 32, name: 'Impostor'),
            pairing.pending,
            pairing.publicBundle,
          ),
      throwsA(isA<MachineMismatchException>()),
    );

    expect(container.read(machinesProvider).machines, isEmpty);
    expect(await MachineStore(StorageService()).load(), isEmpty);
  });

  test(
    'a paired reply whose bundle misses the QR fingerprint is refused',
    () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final pairing = generatedPairing();
      final impostor = LinkIdentity.generate();

      await expectLater(
        container
            .read(machinesProvider.notifier)
            .applyPaired(
              pairedMessage(id: pairing.pending.machineId, name: 'Impostor'),
              pairing.pending,
              impostor.publicBundle,
            ),
        throwsA(isA<MachineMismatchException>()),
      );

      expect(container.read(machinesProvider).machines, isEmpty);
      expect(await MachineStore(StorageService()).load(), isEmpty);
    },
  );

  test('a malformed paired message is refused', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final pairing = generatedPairing();
    final id = pairing.pending.machineId;
    final notifier = container.read(machinesProvider.notifier);

    final messages = <Map<String, Object?>>[
      {'t': 'paired'},
      {...pairedMessage(id: id, name: 'Studio Mac'), 'relay_token': 12},
      pairedMessage(id: 7, name: 'Studio Mac'),
      pairedMessage(id: id, name: 'Studio Mac', os: 3),
      pairedMessage(id: id, name: 'Studio Mac', lan: '10.0.0.2:8765'),
      pairedMessage(id: id, name: 'Studio Mac', relay: 'ftp://example/x'),
    ];

    for (final message in messages) {
      await expectLater(
        notifier.applyPaired(message, pairing.pending, pairing.publicBundle),
        throwsA(isA<MalformedControlMessageException>()),
        reason: '$message',
      );
    }

    expect(container.read(machinesProvider).machines, isEmpty);
  });

  test('applyRoutes moves a known machine onto the new endpoints', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final pairing = generatedPairing();
    await pair(container, pairing.pending, pairing.publicBundle);
    final before = container.read(machinesProvider).machines.single;

    await container.read(machinesProvider.notifier).applyRoutes(before.id, {
      'relay': 'ws://10.0.0.9:7777',
      'lan': ['10.0.0.9:7777', '10.0.0.3:8765'],
    });
    final after = container.read(machinesProvider).machines.single;

    expect(after.id, before.id);
    expect(after.relay, Uri.parse('ws://10.0.0.9:7777'));
    expect(after.lan, ['10.0.0.9:7777', '10.0.0.3:8765']);
    expect(after.relayToken, before.relayToken);
    expect(after.fingerprint, before.fingerprint);
    final stored = (await MachineStore(StorageService()).load()).single;
    expect(stored.relay, Uri.parse('ws://10.0.0.9:7777'));
    expect(stored.lan, ['10.0.0.9:7777', '10.0.0.3:8765']);
  });

  test('applyRoutes clears a relay the daemon dropped', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final pairing = generatedPairing();
    await pair(container, pairing.pending, pairing.publicBundle);

    await container.read(machinesProvider.notifier).applyRoutes(
      container.read(machinesProvider).machines.single.id,
      {'relay': null, 'lan': <String>[]},
    );

    final machine = container.read(machinesProvider).machines.single;
    expect(machine.relay, isNull);
    expect(machine.lan, isEmpty);
  });

  test('applyRoutes for an unknown machine changes nothing', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    await container.read(machinesProvider.notifier).applyRoutes('f' * 32, {
      'relay': 'wss://relay.example/x',
      'lan': <String>[],
    });

    expect(container.read(machinesProvider).machines, isEmpty);
    expect(await MachineStore(StorageService()).load(), isEmpty);
  });

  test('a malformed routes push leaves the machine untouched', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final pairing = generatedPairing();
    await pair(container, pairing.pending, pairing.publicBundle);
    final before = container.read(machinesProvider).machines.single;

    await expectLater(
      container.read(machinesProvider.notifier).applyRoutes(before.id, {
        'relay': 5,
        'lan': <String>[],
      }),
      throwsA(isA<MalformedControlMessageException>()),
    );

    final after = container.read(machinesProvider).machines.single;
    expect(after.relay, before.relay);
    expect(after.lan, before.lan);
  });

  test('select, touchConnected and remove drive the stored list', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(machinesProvider.notifier);
    final machine = fixtureMachine();

    await notifier.add(machine);
    expect(container.read(machinesProvider).selectedId, machine.id);

    await notifier.select(null);
    expect(container.read(machinesProvider).selectedId, isNull);

    final at = DateTime.utc(2026, 5, 6, 7, 8, 9);
    await notifier.touchConnected(machine.id, at);
    expect(
      container.read(machinesProvider).machines.single.lastConnectedAt,
      at,
    );
    expect(
      (await MachineStore(
        StorageService(),
      ).load()).single.lastConnectedAt?.isAtSameMomentAs(at),
      isTrue,
    );

    await notifier.remove(machine.id);
    expect(container.read(machinesProvider).machines, isEmpty);
    expect(await MachineStore(StorageService()).load(), isEmpty);
  });

  test('a touch for a machine that is gone changes nothing', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    await container
        .read(machinesProvider.notifier)
        .touchConnected('f' * 32, DateTime.utc(2026, 5, 6));

    expect(container.read(machinesProvider).machines, isEmpty);
  });

  test('removing the selected machine clears the selection', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final pairing = generatedPairing();
    await pair(container, pairing.pending, pairing.publicBundle);
    final id = container.read(machinesProvider).selectedId;
    expect(id, isNotNull);

    await container.read(machinesProvider.notifier).remove(id!);

    expect(container.read(machinesProvider).selectedId, isNull);
    expect(await MachineStore(StorageService()).loadSelectedId(), isNull);
  });

  test('selecting a machine this phone does not know throws', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    await expectLater(
      container.read(machinesProvider.notifier).select('f' * 32),
      throwsA(isA<StateError>()),
    );
    expect(container.read(machinesProvider).selectedId, isNull);
  });

  test('a stored list is loaded with its selected machine', () async {
    FlutterSecureStorage.setMockInitialValues({
      _machinesKey: jsonEncode([fixtureMachine().toJson()]),
      _selectedKey: fixtureMachine().id,
    });
    final container = ProviderContainer();
    addTearDown(container.dispose);

    container.read(machinesProvider);
    await pumpEventQueue();

    final state = container.read(machinesProvider);
    expect(state.machines.single.id, fixtureMachine().id);
    expect(state.selectedId, fixtureMachine().id);
  });

  test('a selection for a machine that is gone loads as none', () async {
    FlutterSecureStorage.setMockInitialValues({
      _machinesKey: jsonEncode([fixtureMachine().toJson()]),
      _selectedKey: 'f' * 32,
    });
    final container = ProviderContainer();
    addTearDown(container.dispose);

    container.read(machinesProvider);
    await pumpEventQueue();

    expect(container.read(machinesProvider).selectedId, isNull);
  });
}
