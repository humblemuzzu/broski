import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime_event.dart';

class RuntimeReplayTracker {
  RuntimeReplayTracker._();

  static final RuntimeReplayTracker instance = RuntimeReplayTracker._();

  final Map<String, int> _lastSeqByKey = {};

  void remember(RuntimeEvent event) {
    final seq = event.seq;
    if (seq == null || seq <= 0) return;
    final key = _key(
      backend: event.backend,
      sessionId: event.sessionId,
      cwd: event.cwd,
    );
    final previous = _lastSeqByKey[key];
    if (previous == null || seq > previous) {
      _lastSeqByKey[key] = seq;
    }
  }

  int? lastSeq({required AgentType backend, String? sessionId, String? cwd}) {
    return _lastSeqByKey[_key(
      backend: backend,
      sessionId: sessionId,
      cwd: cwd,
    )];
  }

  String _key({required AgentType backend, String? sessionId, String? cwd}) {
    final normalizedSessionId = (sessionId ?? '').trim();
    if (normalizedSessionId.isNotEmpty) {
      return '${backend.wireValue}::$normalizedSessionId';
    }
    final normalizedCwd = (cwd ?? '').trim();
    return '${backend.wireValue}::cwd::$normalizedCwd';
  }
}
