part of '../storage_service.dart';

/// Persisted Pi Durable settings.
extension StoragePiDurable on StorageService {
  static const _piDurableEnabledKey = 'broski_pi_durable_enabled';

  /// Whether the Pi Durable (experimental) backend is visible. Defaults OFF.
  Future<bool> getPiDurableEnabled() async {
    final raw = await _storage.read(key: _piDurableEnabledKey);
    return raw == 'true';
  }

  Future<void> setPiDurableEnabled(bool enabled) async {
    await _storage.write(key: _piDurableEnabledKey, value: enabled.toString());
  }
}
