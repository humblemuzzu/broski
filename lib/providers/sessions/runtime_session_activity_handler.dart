import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/models/session.dart';
import 'package:broski/providers/sessions/runtime_session_snapshot_handler.dart';

String? runtimeSessionIdFromEvent(RuntimeEvent event) {
  final sessionId = (event.sessionId ?? '').trim();
  return sessionId.isEmpty ? null : sessionId;
}

SessionStatus? runtimeSessionStatusFromEvent(RuntimeEvent event) {
  return switch (event) {
    RuntimeSessionStateChangedEvent() => runtimeSessionStatusFromState(
      event.state,
    ),
    RuntimeAgentStartedEvent() => const SessionStatus.busy(),
    RuntimeAgentFinishedEvent() => const SessionStatus.idle(),
    RuntimeErrorEvent() => const SessionStatus.idle(),
    RuntimeRetryStartedEvent() => SessionStatus.retry(
      attempt: event.attempt ?? 0,
      message: event.errorMessage ?? '',
      next: event.delayMs ?? 0,
    ),
    RuntimeCompactionStartedEvent() => const SessionStatus.busy(),
    RuntimeRetryFinishedEvent() => null,
    RuntimeCompactionFinishedEvent() => null,
    _ => null,
  };
}

String? runtimeToolNameFromEvent(RuntimeEvent event) {
  return switch (event) {
    RuntimeToolStartedEvent() => event.toolName,
    RuntimeToolUpdatedEvent() => event.toolName,
    RuntimeToolFinishedEvent() => event.toolName,
    _ => null,
  };
}
