import 'dart:convert';
import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The phone's static identity, one per install, shared by every machine it
/// pairs with.
class DeviceIdentityStore {
  static const _key = 'broski_link_device_identity';

  final FlutterSecureStorage _storage = const FlutterSecureStorage(
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  Future<LinkIdentity>? _loading;

  /// Reads the stored identity, generating one on first run.
  ///
  /// A stored identity that does not decode is an error, never a regeneration:
  /// a fresh key would orphan every machine already paired with this phone.
  Future<LinkIdentity> load() async {
    final loading = _loading;
    if (loading != null) return loading;
    final attempt = _readOrCreate();
    _loading = attempt;
    try {
      return await attempt;
    } catch (_) {
      if (identical(_loading, attempt)) _loading = null;
      rethrow;
    }
  }

  Future<String> deviceId() async => (await load()).id;

  Future<Uint8List> secret() async => (await load()).secret;

  Future<Uint8List> publicBundle() async => (await load()).publicBundle;

  Future<LinkIdentity> _readOrCreate() async {
    final stored = await _storage.read(key: _key);
    if (stored == null) {
      final identity = LinkIdentity.generate();
      await _storage.write(key: _key, value: base64Url.encode(identity.secret));
      return identity;
    }
    final secret = _decodeSecret(stored);
    try {
      return LinkIdentity.fromSecret(secret);
    } on LinkException catch (error) {
      throw DeviceIdentityCorruptException(error.message);
    }
  }

  Uint8List _decodeSecret(String stored) {
    final Uint8List bytes;
    try {
      bytes = base64Url.decode(stored);
    } on FormatException {
      throw const DeviceIdentityCorruptException(
        'the stored identity is not base64url',
      );
    }
    if (bytes.length != identitySecretLength) {
      throw DeviceIdentityCorruptException(
        'the stored identity is ${bytes.length} bytes',
      );
    }
    return bytes;
  }
}

/// The stored device identity cannot be read.
final class DeviceIdentityCorruptException implements Exception {
  const DeviceIdentityCorruptException(this.message);

  final String message;

  @override
  String toString() => 'DeviceIdentityCorruptException: $message';
}
