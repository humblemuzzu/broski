import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/chat/runtime_event_models.dart';
import 'package:broski/providers/chat/runtime_shadow_state.dart';

const _maxRecentEventFingerprints = 200;
const _maxSeenPermissionRequestIds = 50;

RuntimeShadowSessionState reduceRuntimeEvent(
  RuntimeShadowSessionState? current,
  RuntimeEvent event,
) {
  final session = _ensureSessionState(
    current,
    backend: event.backend,
    sessionId: event.sessionId,
    cwd: event.cwd,
  );
  final fingerprint = _runtimeEventFingerprint(event);
  if (session.recentEventFingerprints.contains(fingerprint)) {
    return session;
  }

  var next = _rememberEventFingerprint(session, fingerprint);
  switch (event) {
    case RuntimeAgentStartedEvent():
      if (!next.isStreaming) {
        next = next.copyWith(
          isStreaming: true,
          assistantText: '',
          thinkingText: '',
          tools: const {},
          permissionPromptCount: 0,
        );
      } else {
        next = next.copyWith(isStreaming: true);
      }
      break;
    case RuntimeAgentFinishedEvent():
      next = next.copyWith(isStreaming: false);
      break;
    case RuntimeAssistantTextDeltaEvent():
      next = next.copyWith(assistantText: next.assistantText + event.delta);
      break;
    case RuntimeAssistantThinkingDeltaEvent():
      next = next.copyWith(thinkingText: next.thinkingText + event.delta);
      break;
    case RuntimeToolStartedEvent():
      next = _upsertTool(
        next,
        callId: event.toolCallId,
        name: event.toolName,
        status: 'running',
        input: _mapValue(event.input),
      );
      break;
    case RuntimeToolUpdatedEvent():
      next = _upsertTool(
        next,
        callId: event.toolCallId,
        name: event.toolName,
        status: 'running',
        input: _mapValue(event.input),
        output: event.partialOutput?.toString(),
      );
      break;
    case RuntimeToolFinishedEvent():
      next = _upsertTool(
        next,
        callId: event.toolCallId,
        name: event.toolName,
        status: event.isError == true ? 'failed' : 'completed',
        input: _mapValue(event.input),
        output: event.output?.toString(),
      );
      break;
    case RuntimePermissionRequestedEvent():
      final requestId = (event.request.requestId ?? '').trim();
      if (requestId.isNotEmpty &&
          next.seenPermissionRequestIds.contains(requestId)) {
        return next;
      }
      next = next.copyWith(
        permissionPromptCount: next.permissionPromptCount + 1,
        seenPermissionRequestIds: requestId.isEmpty
            ? next.seenPermissionRequestIds
            : _rememberSeenPermissionRequestId(
                next.seenPermissionRequestIds,
                requestId,
              ),
      );
      break;
    case RuntimeSessionStateChangedEvent():
      next = reduceRuntimeState(next, event.state);
      break;
    case RuntimeErrorEvent():
      next = next.copyWith(isStreaming: false);
      break;
    case RuntimeCompactionStartedEvent():
    case RuntimeCompactionFinishedEvent():
    case RuntimeRetryStartedEvent():
    case RuntimeRetryFinishedEvent():
    case RuntimeBackendEvent():
    case RuntimeUserInputRequestedEvent():
      break;
  }

  return _bumpSession(next);
}

RuntimeShadowSessionState reduceRuntimeState(
  RuntimeShadowSessionState? current,
  RuntimeState runtimeState,
) {
  final session = _ensureSessionState(
    current,
    backend: runtimeState.backend,
    sessionId: runtimeState.sessionId,
    cwd: runtimeState.cwd,
  );

  return _bumpSession(
    session.copyWith(
      sessionId: runtimeState.sessionId ?? session.sessionId,
      cwd: runtimeState.cwd ?? session.cwd,
      isStreaming: runtimeState.isStreaming,
      permissionPromptCount: runtimeState.permissionRequest == null ? 0 : 1,
    ),
  );
}

String buildRuntimeSessionKeyForEvent(RuntimeEvent event) {
  return buildRuntimeSessionKey(
    backend: event.backend,
    sessionId: event.sessionId,
    cwd: event.cwd,
  );
}

String buildRuntimeSessionKeyForState(RuntimeState runtimeState) {
  return buildRuntimeSessionKey(
    backend: runtimeState.backend,
    sessionId: runtimeState.sessionId,
    cwd: runtimeState.cwd,
  );
}

RuntimeShadowSessionState _ensureSessionState(
  RuntimeShadowSessionState? current, {
  required AgentType backend,
  String? sessionId,
  String? cwd,
}) {
  if (current != null) {
    return current.copyWith(
      sessionId: sessionId ?? current.sessionId,
      cwd: cwd ?? current.cwd,
    );
  }

  final sessionKey = buildRuntimeSessionKey(
    backend: backend,
    sessionId: sessionId,
    cwd: cwd,
  );
  return RuntimeShadowSessionState(
    backend: backend,
    sessionKey: sessionKey,
    sessionId: sessionId,
    cwd: cwd,
  );
}

RuntimeShadowSessionState _rememberEventFingerprint(
  RuntimeShadowSessionState session,
  String fingerprint,
) {
  final nextFingerprints = [...session.recentEventFingerprints, fingerprint];
  final trimmed = nextFingerprints.length <= _maxRecentEventFingerprints
      ? nextFingerprints
      : nextFingerprints.sublist(
          nextFingerprints.length - _maxRecentEventFingerprints,
        );
  return session.copyWith(recentEventFingerprints: trimmed);
}

RuntimeShadowSessionState _upsertTool(
  RuntimeShadowSessionState session, {
  String? callId,
  String? name,
  required String status,
  Map<String, dynamic>? input,
  String? output,
}) {
  final normalizedCallId = (callId ?? '').trim();
  final toolId = normalizedCallId.isEmpty
      ? 'tool-${session.tools.length + 1}'
      : normalizedCallId;
  final current = session.tools[toolId];

  final nextTool =
      (current ??
              RuntimeShadowToolState(
                callId: toolId,
                name: (name ?? '').trim().isEmpty ? 'tool' : name!.trim(),
                status: status,
              ))
          .copyWith(
            name: (name ?? '').trim().isEmpty ? null : name!.trim(),
            status: status,
            input: input ?? current?.input,
            output: output,
          );

  return session.copyWith(tools: {...session.tools, toolId: nextTool});
}

RuntimeShadowSessionState _bumpSession(RuntimeShadowSessionState session) {
  return session.copyWith(
    revision: session.revision + 1,
    lastUpdatedAtMs: DateTime.now().millisecondsSinceEpoch,
  );
}

List<String> _rememberSeenPermissionRequestId(
  List<String> existing,
  String requestId,
) {
  final next = [...existing, requestId];
  if (next.length <= _maxSeenPermissionRequestIds) return next;
  return next.sublist(next.length - _maxSeenPermissionRequestIds);
}

String _runtimeEventFingerprint(RuntimeEvent event) {
  final parts = <String>[
    event.type,
    event.backend.wireValue,
    event.sessionId ?? '',
    event.cwd ?? '',
    event.messageId ?? '',
    event.toolCallId ?? '',
    event.streamId ?? '',
    event.turnId ?? '',
    event.seq?.toString() ?? event.timestampMs.toString(),
  ];

  switch (event) {
    case RuntimeAssistantTextDeltaEvent():
      parts.add(event.delta);
      break;
    case RuntimeAssistantThinkingDeltaEvent():
      parts.add(event.delta);
      break;
    case RuntimeToolStartedEvent():
      parts.add(event.toolName ?? '');
      parts.add(event.input.toString());
      break;
    case RuntimeToolUpdatedEvent():
      parts.add(event.toolName ?? '');
      parts.add(event.partialOutput.toString());
      break;
    case RuntimeToolFinishedEvent():
      parts.add(event.toolName ?? '');
      parts.add(event.output.toString());
      parts.add((event.isError ?? false).toString());
      break;
    case RuntimePermissionRequestedEvent():
      parts.add(event.request.requestId ?? '');
      break;
    case RuntimeSessionStateChangedEvent():
      parts.add(event.state.isStreaming.toString());
      parts.add(event.state.permissionRequest?.requestId ?? '');
      break;
    case RuntimeCompactionStartedEvent():
      parts.add(event.reason ?? '');
      break;
    case RuntimeCompactionFinishedEvent():
      parts.add((event.aborted ?? false).toString());
      parts.add((event.willRetry ?? false).toString());
      parts.add(event.errorMessage ?? '');
      break;
    case RuntimeRetryStartedEvent():
      parts.add('${event.attempt}:${event.maxAttempts}:${event.delayMs}');
      break;
    case RuntimeRetryFinishedEvent():
      parts.add('${event.attempt}:${event.success}:${event.finalError}');
      break;
    case RuntimeErrorEvent():
      parts.add(event.message);
      parts.add(event.code ?? '');
      break;
    case RuntimeBackendEvent():
      parts.add(event.kind);
      break;
    case RuntimeAgentStartedEvent():
    case RuntimeAgentFinishedEvent():
    case RuntimeUserInputRequestedEvent():
      break;
  }
  return parts.join('|');
}

Map<String, dynamic>? _mapValue(Object? value) {
  if (value is! Map) return null;
  return value.map((key, entry) => MapEntry(key.toString(), entry));
}
