import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/models/session.dart';

SessionStatus runtimeSessionStatusFromState(RuntimeState runtimeState) {
  final backendData = runtimeState.backendData;
  final rawStatus = backendData == null ? null : backendData['status'];
  final parsedBackendStatus = _runtimeSessionStatusFromBackendStatus(rawStatus);
  if (parsedBackendStatus != null) {
    return parsedBackendStatus;
  }

  if (runtimeState.isRetrying) {
    return const SessionStatus.retry(attempt: 0, message: '', next: 0);
  }
  if (runtimeState.isStreaming || runtimeState.isCompacting) {
    return const SessionStatus.busy();
  }
  return const SessionStatus.idle();
}

Map<String, SessionStatus> runtimeSessionStatusesFromSummaries(
  List<RuntimeSessionSummary> sessions,
) {
  final updates = <String, SessionStatus>{};
  for (final session in sessions) {
    if (session.id.isEmpty) continue;
    final status = runtimeSessionStatusFromSummary(session);
    if (status != null) {
      updates[session.id] = status;
    }
  }
  return updates;
}

SessionStatus? runtimeSessionStatusFromSummary(RuntimeSessionSummary session) {
  final parsedBackendStatus = _runtimeSessionStatusFromBackendStatus(
    session.backendData == null ? null : session.backendData!['status'],
  );
  if (parsedBackendStatus != null) {
    return parsedBackendStatus;
  }

  final isActive = session.isActive;
  if (isActive != null) {
    return isActive ? const SessionStatus.busy() : const SessionStatus.idle();
  }

  return null;
}

SessionStatus? _runtimeSessionStatusFromBackendStatus(Object? rawStatus) {
  final status = switch (rawStatus) {
    final Map<String, dynamic> map => map,
    final Map map => map.cast<String, dynamic>(),
    _ => null,
  };
  if (status == null || status.isEmpty) return null;

  final type = (status['type'] as String? ?? '').trim().toLowerCase();
  switch (type) {
    case 'busy':
    case 'active':
    case 'running':
    case 'streaming':
      return const SessionStatus.busy();
    case 'retry':
      return SessionStatus.retry(
        attempt: (status['attempt'] as num?)?.toInt() ?? 0,
        message: status['message'] as String? ?? '',
        next: (status['next'] as num?)?.toInt() ?? 0,
      );
    case 'idle':
    case 'completed':
      return const SessionStatus.idle();
    default:
      return null;
  }
}
