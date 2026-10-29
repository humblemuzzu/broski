import 'package:broski/agent/client/contract_failure.dart';

/// The answer to one request: the response of the type asked for, or why
/// there is none.
sealed class ContractReply<R> {
  const ContractReply();
}

final class Answered<R> extends ContractReply<R> {
  const Answered(this.response, {required this.arrival});

  final R response;

  /// Where the answer came among the bridge's frames: events numbered below it
  /// were sent before it, events above it after (`ContractClient.received`).
  final int arrival;
}

final class Failed<R> extends ContractReply<R> {
  const Failed(this.failure);

  final ContractFailure failure;
}
