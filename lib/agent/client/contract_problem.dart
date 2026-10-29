import 'package:broski/contract/generated/contract.dart';

/// Something the bridge sent that no request was waiting for and that went
/// wrong: the app shows it, and resyncs a session whose event it lost.
sealed class ContractProblem {
  const ContractProblem();

  String get message;
}

/// A contract frame that did not decode. [session] names the session when
/// the frame was an event this app could still attribute.
final class UnreadableFrame extends ContractProblem {
  const UnreadableFrame({required this.message, this.session});

  @override
  final String message;
  final SessionRef? session;
}

/// An `error` about a request the bridge could not read at all.
final class UnattributedError extends ContractProblem {
  const UnattributedError(this.error);

  final ProtocolError error;

  @override
  String get message => error.message;
}
