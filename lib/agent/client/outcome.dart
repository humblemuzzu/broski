import 'package:broski/agent/client/contract_failure.dart';
import 'package:broski/contract/generated/contract.dart';

/// How one request ended: done, refused by the bridge or backend with a
/// typed rejection, or never answered normally.
sealed class Outcome<T> {
  const Outcome();
}

final class Done<T> extends Outcome<T> {
  const Done(this.value);

  final T value;
}

/// The request reached the backend, which refused it (contract §10, §12.1).
final class Refused<T> extends Outcome<T> {
  const Refused(this.rejection);

  final Rejection rejection;
}

final class Unreached<T> extends Outcome<T> {
  const Unreached(this.failure);

  final ContractFailure failure;
}

/// What a person reads for an outcome that is not [Done], or null.
String? problemOf<T>(Outcome<T> outcome) => switch (outcome) {
  Done() => null,
  Refused(:final rejection) => rejection.message,
  Unreached(:final failure) => failure.message,
};
