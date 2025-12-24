import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/connection.dart';

class StorageService {
  static const _connectionKey = 'broski_connection';
  static const _disabledToolsKey = 'broski_disabled_tools';

  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  Future<void> saveConnection(ConnectionInfo info) async {
    await _storage.write(key: _connectionKey, value: jsonEncode(info.toJson()));
  }

  Future<ConnectionInfo?> loadConnection() async {
    final raw = await _storage.read(key: _connectionKey);
    if (raw == null) return null;
    final data = jsonDecode(raw) as Map<String, dynamic>;
    return ConnectionInfo.fromJson(data);
  }

  Future<void> clearConnection() async {
    await _storage.delete(key: _connectionKey);
  }

  // Generic string storage methods
  Future<String?> getString(String key) async {
    return _storage.read(key: key);
  }

  Future<void> setString(String key, String value) async {
    await _storage.write(key: key, value: value);
  }

  // Tool settings
  Future<Set<String>> getDisabledTools() async {
    final raw = await _storage.read(key: _disabledToolsKey);
    if (raw == null) return {};
    try {
      final List<dynamic> list = jsonDecode(raw);
      return Set<String>.from(list.cast<String>());
    } catch (_) {
      return {};
    }
  }

  Future<void> saveDisabledTools(Set<String> disabledTools) async {
    final json = jsonEncode(disabledTools.toList());
    await _storage.write(key: _disabledToolsKey, value: json);
  }
}
