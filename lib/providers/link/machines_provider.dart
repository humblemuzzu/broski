import 'package:broski/agent/cache/cache_directories.dart'
    show cacheDirectoriesProvider;
import 'package:broski/models/link/link_control_exception.dart';
import 'package:broski/models/link/machine.dart';
import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski/providers/link/link_providers.dart';
import 'package:broski/services/link/discovery/lan_search.dart';
import 'package:broski/services/link/machine_store.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The phone's device identity every pairing is built on.
final deviceIdentityProvider = FutureProvider<LinkIdentity>(
  (ref) => ref.watch(deviceIdentityStoreProvider).load(),
);

final machinesProvider = StateNotifierProvider<MachinesNotifier, MachinesState>(
  (ref) => MachinesNotifier(
    ref.watch(machineStoreProvider),
    onRemoved: (id) => ref.read(cacheDirectoriesProvider).forget(id),
  ),
);

class MachinesState {
  const MachinesState({this.machines = const [], this.selectedId});

  final List<Machine> machines;
  final String? selectedId;
}

class MachinesNotifier extends StateNotifier<MachinesState> {
  MachinesNotifier(this._store, {Future<void> Function(String id)? onRemoved})
    : _onRemoved = onRemoved,
      super(const MachinesState()) {
    _ready = _load();
  }

  final MachineStore _store;

  /// Drops what the phone keeps of a machine besides its pairing.
  final Future<void> Function(String id)? _onRemoved;

  /// Set before the constructor returns, so every mutation waits for the
  /// stored list instead of racing it.
  late final Future<void> _ready;

  Future<void> _load() async {
    final machines = await _store.load();
    final selectedId = await _store.loadSelectedId();
    if (!mounted) return;
    _publish(
      machines,
      machines.any((machine) => machine.id == selectedId) ? selectedId : null,
    );
  }

  /// Adds a machine, selecting it when nothing is selected yet.
  Future<void> add(Machine machine) async {
    await _ready;
    final machines = await _store.upsert(machine);
    final selectedId = state.selectedId ?? machine.id;
    await _store.saveSelectedId(selectedId);
    _publish(machines, selectedId);
  }

  Future<void> update(Machine machine) async {
    await _ready;
    _publish(await _store.upsert(machine), state.selectedId);
  }

  Future<void> remove(String id) async {
    await _ready;
    final machines = await _store.remove(id);
    final selectedId = state.selectedId == id ? null : state.selectedId;
    await _store.saveSelectedId(selectedId);
    _publish(machines, selectedId);
    await _onRemoved?.call(id);
  }

  Future<void> select(String? id) async {
    await _ready;
    if (id != null && _machineOrNull(id) == null) {
      throw StateError('unknown machine $id');
    }
    await _store.saveSelectedId(id);
    _publish(state.machines, id);
  }

  Future<void> touchConnected(String id, DateTime at) async {
    await _ready;
    final machine = _machineOrNull(id);
    if (machine == null) return;
    await update(machine.copyWith(lastConnectedAt: at));
  }

  /// Builds the machine from the daemon's `paired` reply to a pairing this
  /// phone started, and stores it only when it is the machine the QR pinned.
  Future<void> applyPaired(
    Map<String, Object?> paired,
    PendingPairing pending,
    Uint8List publicBundle,
  ) async {
    final reply = _parsePairedMachine(paired);
    if (reply.id != pending.machineId) {
      throw MachineMismatchException(
        'machine ${reply.id} is not the machine the QR pinned',
      );
    }
    if (!listEquals(sha256(publicBundle), pending.fingerprint)) {
      throw const MachineMismatchException(
        'the machine public bundle does not match the QR fingerprint',
      );
    }

    await add(
      Machine(
        id: reply.id,
        name: reply.name,
        os: reply.os,
        publicBundle: publicBundle,
        fingerprint: pending.fingerprint,
        relay: reply.relay,
        lan: reply.lan,
        relayToken: reply.relayToken,
        pairedAt: DateTime.now(),
      ),
    );
  }

  /// Applies a `routes` push: the reported LAN routes go in front of the ones
  /// the record already had, so a machine that returns to an earlier address is
  /// still dialled there. One for a machine this phone no longer knows is
  /// dropped: there is nothing left to route to.
  Future<void> applyRoutes(
    String machineId,
    Map<String, Object?> routes,
  ) async {
    await _ready;
    final machine = _machineOrNull(machineId);
    if (machine == null) return;
    final relay = _parseRelay(routes['relay']);
    await update(
      machine.copyWith(
        relay: relay,
        clearRelay: relay == null,
        lan: mergeLanRoutes(_parseLan(routes['lan']), machine.lan),
      ),
    );
  }

  /// Puts [routes] at the front of [id]'s LAN candidates, keeping the ones that
  /// already work, and returns the machine as it now stands.
  Future<Machine?> mergeLan(String id, List<String> routes) async {
    await _ready;
    final machine = _machineOrNull(id);
    if (machine == null) return null;
    final merged = mergeLanRoutes(routes, machine.lan);
    if (listEquals(merged, machine.lan)) return machine;
    final updated = machine.copyWith(lan: merged);
    await update(updated);
    return updated;
  }

  Machine? _machineOrNull(String id) {
    final index = state.machines.indexWhere((machine) => machine.id == id);
    return index < 0 ? null : state.machines[index];
  }

  void _publish(List<Machine> machines, String? selectedId) {
    state = MachinesState(
      machines: List.unmodifiable(machines),
      selectedId: selectedId,
    );
  }
}

({
  String id,
  String name,
  String? os,
  Uri? relay,
  List<String> lan,
  String? relayToken,
})
_parsePairedMachine(Map<String, Object?> paired) {
  final raw = paired['machine'];
  if (raw is! Map<String, Object?>) {
    throw const MalformedControlMessageException(
      'paired has no machine object',
    );
  }
  final id = raw['id'];
  final name = raw['name'];
  final os = raw['os'];
  final relayToken = paired['relay_token'];
  if (id is! String || name is! String || os is! String?) {
    throw const MalformedControlMessageException(
      'machine fields are not strings',
    );
  }
  if (relayToken is! String?) {
    throw const MalformedControlMessageException('relay_token is not a string');
  }
  return (
    id: id,
    name: name,
    os: os,
    relay: _parseRelay(raw['relay']),
    lan: _parseLan(raw['lan']),
    relayToken: relayToken,
  );
}

Uri? _parseRelay(Object? raw) {
  if (raw == null) return null;
  if (raw is! String) {
    throw const MalformedControlMessageException('relay is not a url');
  }
  final uri = Uri.tryParse(raw);
  if (uri == null || (uri.scheme != 'ws' && uri.scheme != 'wss')) {
    throw MalformedControlMessageException('relay is not a ws url: $raw');
  }
  return uri;
}

List<String> _parseLan(Object? raw) {
  if (raw == null) return const [];
  if (raw is! List) {
    throw const MalformedControlMessageException('lan is not a list');
  }
  final entries = <String>[];
  for (final entry in raw) {
    if (entry is! String || entry.isEmpty) {
      throw const MalformedControlMessageException('lan entries are not hosts');
    }
    entries.add(entry);
  }
  return entries;
}
