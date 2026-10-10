import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski_link/broski_link.dart';

/// A scanned QR the Link flow cannot pair with.
sealed class PairingInputException implements Exception {
  const PairingInputException(this.message);

  final String message;

  @override
  String toString() => '$runtimeType: $message';
}

/// The QR is a Link offer, but not one this build can read.
final class MalformedPairingException extends PairingInputException {
  const MalformedPairingException(super.message);
}

/// The QR is a Link offer that is past its expiry second.
final class ExpiredPairingException extends PairingInputException {
  ExpiredPairingException(this.expiresAt)
    : super('the pairing QR expired at $expiresAt');

  final DateTime expiresAt;
}

/// Reads a scanned QR as a Link v2 pairing offer.
///
/// Returns null for anything that is not a `broski://pair` URI, so a legacy QR
/// payload still reaches the parser that owns it.
PendingPairing? parsePairingInput(String scanned, DateTime now) {
  final text = scanned.trim();
  final uri = Uri.tryParse(text);
  if (uri == null || uri.scheme != 'broski' || uri.host != 'pair') return null;

  final offer = _parseOffer(text);
  final expiresAt = DateTime.fromMillisecondsSinceEpoch(
    offer.expiresAt * 1000,
    isUtc: true,
  );
  if (offer.isExpired(now.millisecondsSinceEpoch ~/ 1000)) {
    throw ExpiredPairingException(expiresAt);
  }
  return PendingPairing.fromOffer(offer);
}

PairingOffer _parseOffer(String text) {
  try {
    return PairingOffer.parse(text);
  } on LinkException catch (error) {
    throw MalformedPairingException(error.message);
  }
}
