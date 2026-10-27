import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const legacyConnectionKeys = [
  'broski_connection',
  'broski_connection_auth_token',
  'broski_device_id',
];

const legacyConnectionPurgedKey = 'broski_legacy_connection_purged';

/// Removes the bridge auth token, pinned cert and saved hosts that builds
/// before Broski Link left in secure storage. Runs once per install.
Future<void> purgeLegacyConnectionSecrets({
  FlutterSecureStorage storage = const FlutterSecureStorage(),
}) async {
  try {
    if (await storage.read(key: legacyConnectionPurgedKey) != null) return;
    for (final key in legacyConnectionKeys) {
      await storage.delete(key: key);
    }
    await storage.write(key: legacyConnectionPurgedKey, value: '1');
  } catch (error) {
    debugPrint('Legacy connection purge failed: $error');
  }
}
