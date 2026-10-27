import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski/services/link/pairing_input.dart';

/// Reads a scanned QR as a Link v2 offer.
///
/// Anything that is not a Link offer reads as null. A Link offer this build
/// cannot read is reported through [onError] and also reads as null, so a
/// newer QR is refused with a reason instead of a silent nothing.
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
