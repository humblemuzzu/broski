import 'dart:convert';

import 'package:broski/models/link/machine.dart';
import 'package:broski/services/storage/storage_link.dart';
import 'package:broski/services/storage_service.dart';

/// Persists the paired machines and which of them is selected. Each machine is
/// its own secure-storage item so no single item approaches the keychain limit.
class MachineStore {
  MachineStore(this._storage);

  final StorageService _storage;

  Future<List<Machine>> load() async {
    final ids = await _readIndex();
    if (ids == null) return _migrateLegacy();
    final machines = <Machine>[];
    final kept = <String>[];
    for (final id in ids) {
      final machine = await _readMachine(id);
      if (machine == null) continue;
      machines.add(machine);
      kept.add(id);
    }
    if (kept.length != ids.length) await _writeIndex(kept);
    return machines;
  }

  Future<void> save(List<Machine> machines) async {
    final previous = await _readIndex() ?? const <String>[];
    for (final machine in machines) {
      await _writeMachine(machine);
    }
    await _writeIndex([for (final machine in machines) machine.id]);
    for (final id in previous) {
      if (machines.any((machine) => machine.id == id)) continue;
      await _storage.deleteLinkMachine(id);
    }
  }

  Future<List<Machine>> upsert(Machine machine) async {
    final machines = [...await load()];
    final index = machines.indexWhere((stored) => stored.id == machine.id);
    if (index < 0) {
      machines.insert(0, machine);
    } else {
      machines[index] = machine;
    }
    await _writeMachine(machine);
    await _writeIndex([for (final stored in machines) stored.id]);
    return machines;
  }

  Future<List<Machine>> remove(String id) async {
    final machines = [
      for (final machine in await load())
        if (machine.id != id) machine,
    ];
    await _storage.deleteLinkMachine(id);
    await _writeIndex([for (final machine in machines) machine.id]);
    return machines;
  }

  Future<String?> loadSelectedId() => _storage.getSelectedMachineId();

  Future<void> saveSelectedId(String? id) => _storage.setSelectedMachineId(id);

  /// `null` means no index item, so the legacy blob may still hold the list.
  Future<List<String>?> _readIndex() async {
    final raw = await _storage.getLinkMachineIds();
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return [
        for (final id in decoded)
          if (id is String) id,
      ];
    } catch (_) {
      return const [];
    }
  }

  Future<void> _writeIndex(List<String> ids) =>
      _storage.setLinkMachineIds(jsonEncode(ids));

  Future<Machine?> _readMachine(String id) async {
    final raw = await _storage.getLinkMachine(id);
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      return Machine.fromJson(decoded);
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeMachine(Machine machine) =>
      _storage.setLinkMachine(machine.id, jsonEncode(machine.toJson()));

  Future<List<Machine>> _migrateLegacy() async {
    final raw = await _storage.getLegacyLinkMachines();
    if (raw == null) return const [];
    final machines = _decodeLegacy(raw);
    for (final machine in machines) {
      await _writeMachine(machine);
    }
    await _writeIndex([for (final machine in machines) machine.id]);
    await _storage.deleteLegacyLinkMachines();
    return machines;
  }

  List<Machine> _decodeLegacy(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return [
        for (final entry in decoded)
          if (entry is Map<String, dynamic>) Machine.fromJson(entry),
      ];
    } catch (_) {
      return const [];
    }
  }
}
