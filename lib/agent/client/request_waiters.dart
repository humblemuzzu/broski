import 'dart:async';

import 'package:broski/agent/client/agent_clock.dart';
import 'package:broski/agent/client/contract_failure.dart';
import 'package:broski/contract/generated/contract.dart';

/// What came back for one request: its answer, or why none will come.
sealed class WireAnswer {
  const WireAnswer();
}

final class WireAnswered extends WireAnswer {
  const WireAnswered(this.message, {required this.arrival});

  final ServerMessage message;

  /// Where the answer came among the bridge's frames (`ContractClient.received`).
  final int arrival;
}

final class WireFailed extends WireAnswer {
  const WireFailed(this.failure);

  final ContractFailure failure;
}

/// The requests waiting for an answer, by request id. Each ends exactly once:
/// answered, failed, or timed out.
final class RequestWaiters {
  RequestWaiters(this._clock);

  final AgentClock _clock;
  final Map<String, ({Completer<WireAnswer> done, void Function() cancel})>
  _waiting = {};

  bool isWaiting(String requestId) => _waiting.containsKey(requestId);

  Future<WireAnswer> wait(String requestId, Duration deadline) {
    final done = Completer<WireAnswer>();
    final cancel = _clock.after(
      deadline,
      () => _end(requestId, const WireFailed(AnswerTimedOut())),
    );
    _waiting[requestId] = (done: done, cancel: cancel);
    return done.future;
  }

  /// False when nothing waits on [requestId] any more.
  bool answer(
    String requestId,
    ServerMessage message, {
    required int arrival,
  }) => _end(requestId, WireAnswered(message, arrival: arrival));

  bool fail(String requestId, ContractFailure failure) =>
      _end(requestId, WireFailed(failure));

  void failAll(ContractFailure failure) {
    for (final requestId in _waiting.keys.toList()) {
      _end(requestId, WireFailed(failure));
    }
  }

  bool _end(String requestId, WireAnswer answer) {
    final waiter = _waiting.remove(requestId);
    if (waiter == null) return false;
    waiter.cancel();
    waiter.done.complete(answer);
    return true;
  }
}
