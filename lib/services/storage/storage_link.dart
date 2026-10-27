import 'package:broski/services/storage/broski_secure_storage.dart';
import 'package:broski/services/storage_service.dart';

/// Storage keys the Broski Link data layer owns, in the same secure store the
/// rest of the app's secrets use.
extension StorageLink on StorageService {
  static const _legacyMachinesKey = 'broski_link_machines';
  static const _machineIdsKey = 'broski_link_machine_ids';
  static const _machineKeyPrefix = 'broski_link_machine_';
  static const _selectedMachineKey = 'broski_link_selected_machine';

  Future<String?> getLinkMachineIds() => getString(_machineIdsKey);

  Future<void> setLinkMachineIds(String json) =>
      setString(_machineIdsKey, json);

  Future<String?> getLinkMachine(String id) =>
      getString('$_machineKeyPrefix$id');

  Future<void> setLinkMachine(String id, String json) =>
      setString('$_machineKeyPrefix$id', json);

  Future<void> deleteLinkMachine(String id) =>
      broskiSecureStorage.delete(key: '$_machineKeyPrefix$id');

  /// The pre-per-machine single blob, read only to migrate it away.
  Future<String?> getLegacyLinkMachines() => getString(_legacyMachinesKey);

  Future<void> deleteLegacyLinkMachines() =>
      broskiSecureStorage.delete(key: _legacyMachinesKey);

  Future<String?> getSelectedMachineId() async {
    final id = await getString(_selectedMachineKey);
    return id == null || id.isEmpty ? null : id;
  }

  Future<void> setSelectedMachineId(String? id) =>
      setString(_selectedMachineKey, id ?? '');
}
