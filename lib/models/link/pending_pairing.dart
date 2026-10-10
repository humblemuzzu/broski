import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';

/// A scanned `broski://pair?v=2` offer, before the handshake completes.
class PendingPairing {
  PendingPairing._({
    required this.fingerprint,
    required this.secret,
    required this.relay,
    required this.lan,
    required this.name,
    required this.expiresAt,
  });

  factory PendingPairing.fromOffer(PairingOffer offer) {
    final relay = offer.relay;
    return PendingPairing._(
      fingerprint: offer.fingerprint,
      secret: offer.secret,
      relay: relay == null ? null : Uri.parse(relay),
      lan: offer.lan,
      name: offer.name,
      expiresAt: DateTime.fromMillisecondsSinceEpoch(
        offer.expiresAt * 1000,
        isUtc: true,
      ),
    );
  }

  /// The machine bundle fingerprint the QR pins, 32 bytes.
  final Uint8List fingerprint;

  /// The single-use pairing secret mixed into the handshake, 32 bytes.
  final Uint8List secret;
  final Uri? relay;
  final List<String> lan;
  final String name;
  final DateTime expiresAt;

  String get machineId => fingerprint
      .take(16)
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();

  @override
  String toString() => 'PendingPairing($name, expires $expiresAt)';
}
