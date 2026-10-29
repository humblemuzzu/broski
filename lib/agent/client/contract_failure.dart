import 'package:broski/contract/generated/contract.dart';

/// Why a request got no normal answer. A refusal the backend gives is not a
/// failure: it is the `Rejected` member of the request's own result.
sealed class ContractFailure {
  const ContractFailure();

  /// What a person reads.
  String get message;
}

/// The bridge could not handle the request at all (contract §12.1), such as
/// `unknown_session`, `rate_limited` after the client's own retries, or
/// `internal` when a backend never answered within the core's deadline.
final class ProtocolRefusal extends ContractFailure {
  const ProtocolRefusal(this.error);

  final ProtocolError error;

  ProtocolErrorCode get code => error.code;

  @override
  String get message => error.message;
}

/// The connection to the bridge is down, or went down before the answer came:
/// whether the bridge acted on the request is unknown.
final class ConnectionLost extends ContractFailure {
  const ConnectionLost();

  @override
  String get message => 'Not connected to the Mac';
}

/// The link refused to carry the request, so the bridge never saw it.
final class LinkRefusal extends ContractFailure {
  const LinkRefusal(this.reason);

  final String reason;

  @override
  String get message => reason;
}

/// No answer came within the bridge core's own request deadline and a margin
/// for the link, which only a lost answer explains.
final class AnswerTimedOut extends ContractFailure {
  const AnswerTimedOut();

  @override
  String get message => 'The Mac did not answer in time';
}

/// The bridge speaks another major version of the protocol (contract §12.4).
final class VersionMismatch extends ContractFailure {
  const VersionMismatch(this.detail);

  final String detail;

  @override
  String get message => detail;
}

/// The answer broke the contract: it did not decode, or answered another
/// request type.
final class MalformedAnswer extends ContractFailure {
  const MalformedAnswer(this.detail);

  final String detail;

  @override
  String get message => 'The Mac sent an answer this app cannot read: $detail';
}

/// The client was disposed before the answer came.
final class ClientClosed extends ContractFailure {
  const ClientClosed();

  @override
  String get message => 'The connection was closed';
}
