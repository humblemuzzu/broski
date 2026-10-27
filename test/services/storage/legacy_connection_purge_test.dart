import 'package:broski/services/storage/legacy_connection_purge.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'removes the old connection secrets and keeps everything else',
    () async {
      final stored = <String, String>{
        'broski_connection': '{"localIP":"192.168.1.5","certSha256":"AB"}',
        'broski_connection_auth_token': 'old-bridge-token',
        'broski_device_id': 'old-device-id',
        'broski_link_machine_ids': '["a"]',
        'broski_selected_agent_type': 'pi',
      };
      FlutterSecureStorage.setMockInitialValues(stored);

      await purgeLegacyConnectionSecrets();

      expect(stored.keys.toSet(), {
        'broski_link_machine_ids',
        'broski_selected_agent_type',
        legacyConnectionPurgedKey,
      });
    },
  );

  test('runs only once per install', () async {
    final stored = <String, String>{};
    FlutterSecureStorage.setMockInitialValues(stored);
    await purgeLegacyConnectionSecrets();

    stored['broski_connection_auth_token'] = 'written-after-the-purge';
    await purgeLegacyConnectionSecrets();

    expect(stored['broski_connection_auth_token'], 'written-after-the-purge');
  });

  test('does nothing harmful on a fresh install', () async {
    final stored = <String, String>{};
    FlutterSecureStorage.setMockInitialValues(stored);

    await purgeLegacyConnectionSecrets();

    expect(stored, {legacyConnectionPurgedKey: '1'});
  });
}
