/// A link control message this build cannot act on.
sealed class LinkControlException implements Exception {
  const LinkControlException(this.message);

  final String message;

  @override
  String toString() => '$runtimeType: $message';
}

/// The message is not shaped like the control contract.
final class MalformedControlMessageException extends LinkControlException {
  const MalformedControlMessageException(super.message);
}

/// The machine a `paired` message describes is not the machine the QR pinned.
final class MachineMismatchException extends LinkControlException {
  const MachineMismatchException(super.message);
}
