import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

String hex(Uint8List bytes) =>
    bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();

void main() {
  test('generates an identity with a stable id', () {
    final identity = LinkIdentity.generate();
    expect(identity.secret.length, identitySecretLength);
    expect(identity.publicBundle.length, publicBundleLength);
    expect(identity.publicBundle.first, 1, reason: 'version byte');
    expect(identity.secret.first, 1, reason: 'version byte');
    expect(identity.id, matches(RegExp(r'^[0-9a-f]{32}$')));

    final reloaded = LinkIdentity.fromSecret(identity.secret);
    expect(reloaded.publicBundle, identity.publicBundle);
    expect(reloaded.id, identity.id);
  });

  test('two identities differ', () {
    final first = LinkIdentity.generate();
    final second = LinkIdentity.generate();
    expect(first.id, isNot(second.id));
    expect(first.publicBundle, isNot(second.publicBundle));
  });

  test('the id is the first half of the fingerprint', () {
    final identity = LinkIdentity.generate();
    final fingerprint = bundleFingerprint(identity.publicBundle);
    expect(fingerprint, sha256(identity.publicBundle));
    expect(identity.id, hex(fingerprint).substring(0, 32));
  });

  test('rejects a secret of the wrong length', () {
    expect(() => LinkIdentity.fromSecret(Uint8List(5)), throwsArgumentError);
  });

  test('rejects a bundle of the wrong length', () {
    expect(() => bundleFingerprint(Uint8List(5)), throwsArgumentError);
  });
}
