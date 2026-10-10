import 'dart:convert';
import 'dart:typed_data';

import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski/services/link/pairing_input.dart';
import 'package:broski_link/broski_link.dart';

/// The QR grammar writes base64url without padding.
String base64UrlNoPad(Uint8List bytes) =>
    base64Url.encode(bytes).replaceAll('=', '');

Uint8List patternBytes(int length, {int seed = 0}) =>
    Uint8List.fromList(List.generate(length, (index) => (index + seed) & 0xff));

/// Assembles a `broski://pair?v=2` URI by hand, following `link-crypto.md`.
String v2PairUri({
  required Uint8List fingerprint,
  required Uint8List secret,
  required int expiresAt,
  required String name,
  String? relay,
  List<String> lan = const [],
}) {
  final parts = <String>[
    'v=2',
    'h=${base64UrlNoPad(fingerprint)}',
    's=${base64UrlNoPad(secret)}',
    'e=$expiresAt',
    'n=${Uri.encodeComponent(name)}',
    if (relay != null) 'r=${Uri.encodeComponent(relay)}',
    if (lan.isNotEmpty) 'l=${lan.join(',')}',
  ];
  return 'broski://pair?${parts.join('&')}';
}

/// A v2 offer built from a freshly generated identity, plus the bundle that
/// identity's fingerprint was taken over.
({PendingPairing pending, Uint8List publicBundle}) generatedPairing({
  String name = 'Studio Mac',
  int expiresAt = 1900000000,
  String? relay = 'wss://relay.example/x',
  List<String> lan = const ['10.0.0.2:8765'],
}) {
  final identity = LinkIdentity.generate();
  final uri = v2PairUri(
    fingerprint: bundleFingerprint(identity.publicBundle),
    secret: patternBytes(32, seed: 11),
    expiresAt: expiresAt,
    name: name,
    relay: relay,
    lan: lan,
  );
  final pending = parsePairingInput(
    uri,
    DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
  );
  if (pending == null) throw StateError('the fixture uri is not a v2 offer');
  return (pending: pending, publicBundle: identity.publicBundle);
}
