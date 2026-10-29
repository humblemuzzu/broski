import 'package:broski/agent/client/contract_reply.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/contract/generated/contract.dart';

/// [reply] read into an [Outcome]: a failure stays a failure, a response is
/// read by [read].
Outcome<T> outcomeOf<R, T>(
  ContractReply<R> reply,
  Outcome<T> Function(R response) read,
) => switch (reply) {
  Answered(:final response) => read(response),
  Failed(:final failure) => Unreached(failure),
};

Outcome<ActionAccepted> actionOutcome(ActionResult result) => switch (result) {
  ActionAccepted() => Done(result),
  Rejected(:final rejection) => Refused(rejection),
};

Outcome<SessionRef> newSessionOutcome(NewSessionResult result) =>
    switch (result) {
      NewSessionAccepted(:final session) => Done(session),
      Rejected(:final rejection) => Refused(rejection),
    };
