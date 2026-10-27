import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime_session_summary.dart';

/// One row of a session list changing: the bridge sends the row, never the whole list.
sealed class RuntimeSessionDelta {
  const RuntimeSessionDelta();
}

final class RuntimeSessionUpserted extends RuntimeSessionDelta {
  const RuntimeSessionUpserted(this.session);

  final RuntimeSessionSummary session;
}

final class RuntimeSessionRemoved extends RuntimeSessionDelta {
  const RuntimeSessionRemoved({required this.backend, required this.sessionId});

  final AgentType backend;
  final String sessionId;
}

/// Null for any message that is not a session-list delta.
RuntimeSessionDelta? runtimeSessionDeltaFromMessage(
  Map<String, dynamic> message,
) {
  switch (message['type']) {
    case 'runtime_session_updated':
      final data = message['session'];
      if (data is! Map) return null;
      final payload = <String, dynamic>{
        for (final entry in data.entries) entry.key.toString(): entry.value,
      };
      final backend = message['backend'];
      if (backend is String && payload['backend'] == null) {
        payload['backend'] = backend;
      }
      final session = RuntimeSessionSummary.fromJson(payload);
      return session.id.isEmpty ? null : RuntimeSessionUpserted(session);
    case 'runtime_session_removed':
      final sessionId = message['sessionId'];
      if (sessionId is! String || sessionId.isEmpty) return null;
      final backend = message['backend'];
      return RuntimeSessionRemoved(
        backend: AgentType.fromWireValue(
          backend is String && backend.isNotEmpty ? backend : 'pi',
        ),
        sessionId: sessionId,
      );
    default:
      return null;
  }
}
