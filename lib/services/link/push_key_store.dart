import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// What the notification extension and the native action handler need for one
/// machine: where its relay is, who this phone is there, and the key the
/// machine seals every push with.
class MachinePushKey {
  const MachinePushKey({
    required this.machineId,
    required this.machineName,
    required this.relay,
    required this.deviceId,
    required this.relayToken,
    required this.key,
  });

  factory MachinePushKey.fromJson(Map<String, dynamic> json) => MachinePushKey(
    machineId: json['machine_id'] as String,
    machineName: json['machine_name'] as String,
    relay: json['relay'] as String,
    deviceId: json['device_id'] as String,
    relayToken: json['relay_token'] as String,
    key: json['key'] as String,
  );

  final String machineId;
  final String machineName;
  final String relay;
  final String deviceId;
  final String relayToken;

  /// The machine key K: base64url without padding, 32 bytes.
  final String key;

  Map<String, dynamic> toJson() => {
    'machine_id': machineId,
    'machine_name': machineName,
    'relay': relay,
    'device_id': deviceId,
    'relay_token': relayToken,
    'key': key,
  };
}

/// The per-machine push credentials, one keychain item each.
///
/// They live in the access group the app, its notification extension and its
/// action handler share, so the same item is readable while no Flutter engine
/// runs.
class PushKeyStore {
  PushKeyStore(this._storage);

  /// [groupId] is the fully qualified `<team id>.<group>` the two entitlements
  /// files declare; an item written outside it is invisible to the extension.
  factory PushKeyStore.forKeychainGroup(String groupId) => PushKeyStore(
    FlutterSecureStorage(
      iOptions: IOSOptions(
        groupId: groupId,
        accessibility: KeychainAccessibility.first_unlock_this_device,
      ),
      aOptions: const AndroidOptions(encryptedSharedPreferences: true),
    ),
  );

  static const itemPrefix = 'broski_push_';

  static String itemKey(String machineId) => '$itemPrefix$machineId';

  final FlutterSecureStorage _storage;

  Future<MachinePushKey?> read(String machineId) async {
    final raw = await _storage.read(key: itemKey(machineId));
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      final item = MachinePushKey.fromJson(decoded);
      return pushKeyBytes(item.key) == null ? null : item;
    } catch (_) {
      return null;
    }
  }

  /// Writes [machineId]'s credentials, keeping the key it already has: a new
  /// key would make every push sealed before it undecryptable.
  Future<MachinePushKey> write({
    required String machineId,
    required String machineName,
    required Uri relay,
    required String deviceId,
    required String relayToken,
  }) async {
    final key = (await read(machineId))?.key ?? generatePushKey();
    final item = MachinePushKey(
      machineId: machineId,
      machineName: machineName,
      relay: relay.toString(),
      deviceId: deviceId,
      relayToken: relayToken,
      key: key,
    );
    await _storage.write(
      key: itemKey(machineId),
      value: jsonEncode(item.toJson()),
    );
    return item;
  }

  Future<void> forget(Iterable<String> machineIds) async {
    for (final machineId in machineIds) {
      await _storage.delete(key: itemKey(machineId));
    }
  }
}

/// A fresh machine key: 32 bytes from the OS random source.
String generatePushKey() {
  final random = Random.secure();
  return base64UrlNoPad(
    Uint8List.fromList([for (var i = 0; i < 32; i++) random.nextInt(256)]),
  );
}

/// The bytes of a base64url machine key, or null when it is not 32 bytes.
Uint8List? pushKeyBytes(String value) {
  final padding = (4 - value.length % 4) % 4;
  try {
    final bytes = base64Url.decode([value, '=' * padding].join());
    return bytes.length == 32 ? bytes : null;
  } on FormatException {
    return null;
  }
}

String base64UrlNoPad(Uint8List bytes) =>
    base64Url.encode(bytes).replaceAll('=', '');
