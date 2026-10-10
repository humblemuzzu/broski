import 'dart:convert';

import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/services/link/device_identity_store.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'link_fixtures.dart';

const _identityKey = 'broski_link_device_identity';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('creates the identity once and reuses the stored one', () async {
    final stored = <String, String>{};
    FlutterSecureStorage.setMockInitialValues(stored);

    final first = await DeviceIdentityStore().load();
    expect(stored.keys, [_identityKey]);
    expect(stored[_identityKey], base64Url.encode(first.secret));
    expect(first.id, hasLength(32));
    expect(first.publicBundle, hasLength(publicBundleLength));

    final second = await DeviceIdentityStore().load();
    expect(second.id, first.id);
    expect(second.secret, first.secret);
    expect(second.publicBundle, first.publicBundle);
  });

  test('concurrent loads share one generated identity', () async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final store = DeviceIdentityStore();

    final identities = await Future.wait([
      store.load(),
      store.load(),
      store.load(),
    ]);

    expect(identities.map((identity) => identity.id).toSet(), hasLength(1));
  });

  test(
    'exposes the device id, secret and bundle of the same identity',
    () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{});
      final store = DeviceIdentityStore();

      final identity = await store.load();

      expect(await store.deviceId(), identity.id);
      expect(await store.secret(), identity.secret);
      expect(await store.publicBundle(), identity.publicBundle);
    },
  );

  test('a stored identity is reused instead of generated', () async {
    final identity = LinkIdentity.generate();
    FlutterSecureStorage.setMockInitialValues({
      _identityKey: base64Url.encode(identity.secret),
    });

    final loaded = await DeviceIdentityStore().load();

    expect(loaded.id, identity.id);
  });

  group('a stored identity that does not decode', () {
    for (final (String label, String stored) in <(String, String)>[
      ('is not base64url', 'not base64url!'),
      ('is the wrong length', base64Url.encode(patternBytes(32))),
      (
        'has the wrong version',
        base64Url.encode(patternBytes(identitySecretLength, seed: 2)),
      ),
    ]) {
      test('$label throws without being replaced', () async {
        final values = {_identityKey: stored};
        FlutterSecureStorage.setMockInitialValues(values);

        await expectLater(
          DeviceIdentityStore().load(),
          throwsA(isA<DeviceIdentityCorruptException>()),
        );

        expect(values[_identityKey], stored);
      });
    }
  });

  test('deviceIdentityProvider serves the stored identity', () async {
    FlutterSecureStorage.setMockInitialValues({
      _identityKey: base64Url.encode(LinkIdentity.generate().secret),
    });
    final container = ProviderContainer();
    addTearDown(container.dispose);

    final identity = await container.read(deviceIdentityProvider.future);
    final again = await container.read(deviceIdentityProvider.future);

    expect(identity.id, hasLength(32));
    expect(again.id, identity.id);
  });
}
