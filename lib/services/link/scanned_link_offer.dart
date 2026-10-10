import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski/services/link/pairing_input.dart';

/// Reads a scanned QR as a Link v2 offer.
///
/// Returns null for anything that is not a Link offer. A Link offer this build
/// cannot read is reported through [onError] and also reads as null: a
/// malformed v2 QR is not something a newer parser should ever see.
PendingPairing? scannedLinkOffer(
  String raw, {
  required DateTime now,
  required void Function(String message) onError,
}) {
  try {
    return parsePairingInput(raw, now);
  } on PairingInputException catch (failure) {
    onError(failure.message);
    return null;
  }
}
