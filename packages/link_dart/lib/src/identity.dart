import 'dart:convert';
import 'dart:ffi';
import 'dart:typed_data';

import 'package:broski_link/src/bindings.dart';
import 'package:broski_link/src/buffer.dart';
import 'package:broski_link/src/errors.dart';
import 'package:ffi/ffi.dart';

/// This device's static identity: 3617 secret bytes and the 1217-byte bundle
/// the machine pins.
final class LinkIdentity {
  const LinkIdentity._({
    required this.secret,
    required this.publicBundle,
    required this.id,
  });

  factory LinkIdentity.generate() {
    final secret = newBuffer();
    final public = newBuffer();
    try {
      checkStatus(blIdentityGenerate(secret, public));
      final secretBytes = takeBuffer(secret);
      final publicBytes = takeBuffer(public);
      return LinkIdentity._(
        secret: secretBytes,
        publicBundle: publicBytes,
        id: _bundleId(publicBytes),
      );
    } finally {
      calloc
        ..free(secret)
        ..free(public);
    }
  }

  factory LinkIdentity.fromSecret(Uint8List secret) {
    final publicBytes = publicBundleOf(secret);
    return LinkIdentity._(
      secret: Uint8List.fromList(secret),
      publicBundle: publicBytes,
      id: _bundleId(publicBytes),
    );
  }

  final Uint8List secret;
  final Uint8List publicBundle;
  final String id;

  @override
  String toString() => 'LinkIdentity($id)';
}

Uint8List publicBundleOf(Uint8List secret) {
  if (secret.length != identitySecretLength) {
    throw ArgumentError.value(
      secret.length,
      'secret',
      'an identity secret is $identitySecretLength bytes',
    );
  }
  final input = copyIn(secret);
  final output = newBuffer();
  try {
    checkStatus(blIdentityPublic(input, secret.length, output));
    return takeBuffer(output);
  } finally {
    malloc.free(input);
    calloc.free(output);
  }
}

/// SHA-256 over the bundle, 32 bytes.
Uint8List bundleFingerprint(Uint8List publicBundle) {
  if (publicBundle.length != publicBundleLength) {
    throw ArgumentError.value(
      publicBundle.length,
      'publicBundle',
      'a public bundle is $publicBundleLength bytes',
    );
  }
  final input = copyIn(publicBundle);
  final output = malloc.allocate<Uint8>(sha256DigestLength);
  try {
    checkStatus(blBundleFingerprint(input, publicBundle.length, output));
    return Uint8List.fromList(output.asTypedList(sha256DigestLength));
  } finally {
    malloc
      ..free(input)
      ..free(output);
  }
}

String _bundleId(Uint8List publicBundle) {
  final input = copyIn(publicBundle);
  final output = newBuffer();
  try {
    checkStatus(blBundleId(input, publicBundle.length, output));
    return ascii.decode(takeBuffer(output));
  } finally {
    malloc.free(input);
    calloc.free(output);
  }
}
