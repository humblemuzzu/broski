import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/connection.dart';

class StorageService {
  static const _connectionKey = 'broski_connection';

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
}
