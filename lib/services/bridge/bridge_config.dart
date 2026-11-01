part of '../bridge_service.dart';

/// View routing: which session this socket is watching.
extension BridgeServiceConfig on BridgeService {
  void setView({
    String? projectPath,
    String? sessionId,
    String? agent,
    int? lastRuntimeSeq,
  }) {
    final resolvedAgent = agent == null || agent.isEmpty
        ? null
        : AgentType.fromWireValue(agent);
    final resolvedLastSeq =
        lastRuntimeSeq ??
        (resolvedAgent == null
            ? null
            : RuntimeReplayTracker.instance.lastSeq(
                backend: resolvedAgent,
                sessionId: sessionId,
                cwd: projectPath,
              ));
    _socket.send({
      'type': 'set_view',
      if (projectPath != null) 'projectPath': projectPath,
      if (sessionId != null) 'sessionId': sessionId,
      if (agent != null) 'agent': agent,
      if (resolvedLastSeq != null) 'lastRuntimeSeq': resolvedLastSeq,
    });
  }
}
