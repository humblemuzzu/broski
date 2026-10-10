/// A pairing attempt this build cannot complete.
sealed class PairingFailure implements Exception {
  const PairingFailure(this.message);

  /// Wording written for the user, safe to show as-is.
  final String message;

  @override
  String toString() => '$runtimeType: $message';
}

/// No advertised address served a machine bundle in time.
final class IdentityUnreachableFailure extends PairingFailure {
  const IdentityUnreachableFailure(super.message);
}

/// An address answered, but not with the machine the QR pinned.
final class FingerprintMismatchFailure extends PairingFailure {
  const FingerprintMismatchFailure(super.message);
}

/// The machine never confirmed the pairing.
final class PairingTimeoutFailure extends PairingFailure {
  const PairingTimeoutFailure(super.message);
}

/// The machine dropped the session before it confirmed the pairing.
final class PairingRejectedFailure extends PairingFailure {
  const PairingRejectedFailure(super.message);
}
