import 'dart:convert';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/chat/runtime_common_models.dart';

const _maxRuntimeChatFingerprints = 200;

RuntimeChatTurnState reduceRuntimeChatEvent(
  RuntimeChatTurnState? current,
  RuntimeEvent event, {
  Map<String, dynamic> Function(RuntimeEvent event)? metadataForEvent,
}) {
  final session = _ensureRuntimeChatTurnState(
    current,
    backend: event.backend,
    sessionId: event.sessionId,
    cwd: event.cwd,
  );
  final fingerprint = runtimeChatEventFingerprint(event);
  if (session.recentEventFingerprints.contains(fingerprint)) {
    return session;
  }

  var next = _rememberRuntimeChatFingerprint(session, fingerprint);
  switch (event) {
    case RuntimeAgentStartedEvent():
      next = _beginRuntimeTurn(next, event.messageId);
      break;
    case RuntimeAgentFinishedEvent():
      next = next.copyWith(isStreaming: false);
      break;
    case RuntimeAssistantTextDeltaEvent():
      next = _ensureRuntimeTurnIdentity(next, event.messageId);
      next = next.copyWith(
        isStreaming: true,
        assistantText: next.assistantText + event.delta,
        parts: _appendRuntimeTextPart(
          next.parts,
          next.nextPartSequence,
          event.delta,
        ),
        nextPartSequence: _nextRuntimeSequenceForText(
          next.parts,
          next.nextPartSequence,
        ),
      );
      break;
    case RuntimeAssistantThinkingDeltaEvent():
      next = _ensureRuntimeTurnIdentity(next, event.messageId);
      next = next.copyWith(
        isStreaming: true,
        thinkingText: next.thinkingText + event.delta,
      );
      break;
    case RuntimeToolStartedEvent():
      next = _ensureRuntimeTurnIdentity(next, event.messageId);
      next = _upsertRuntimeTool(
        next,
        event: event,
        status: 'running',
        input: _runtimeToolInput(event.input),
        output: null,
        metadata: metadataForEvent?.call(event),
      );
      next = next.copyWith(isStreaming: true);
      break;
    case RuntimeToolUpdatedEvent():
      next = _ensureRuntimeTurnIdentity(next, event.messageId);
      next = _upsertRuntimeTool(
        next,
        event: event,
        status: 'running',
        input: _runtimeToolInput(event.input),
        output: _runtimeStringValue(event.partialOutput),
        metadata: metadataForEvent?.call(event),
      );
      next = next.copyWith(isStreaming: true);
      break;
    case RuntimeToolFinishedEvent():
      next = _ensureRuntimeTurnIdentity(next, event.messageId);
      next = _upsertRuntimeTool(
        next,
        event: event,
        status: event.isError == true ? 'failed' : 'completed',
        input: _runtimeToolInput(event.input),
        output: _runtimeStringValue(event.output),
        metadata: metadataForEvent?.call(event),
      );
      break;
    case RuntimeSessionStateChangedEvent():
      next = reduceRuntimeChatState(next, event.state);
      break;
    case RuntimeErrorEvent():
      next = next.copyWith(isStreaming: false);
      break;
    case RuntimePermissionRequestedEvent():
    case RuntimeUserInputRequestedEvent():
    case RuntimeCompactionStartedEvent():
    case RuntimeCompactionFinishedEvent():
    case RuntimeRetryStartedEvent():
    case RuntimeRetryFinishedEvent():
    case RuntimeBackendEvent():
      break;
  }

  return next;
}

RuntimeChatTurnState reduceRuntimeChatState(
  RuntimeChatTurnState? current,
  RuntimeState runtimeState,
) {
  final session = _ensureRuntimeChatTurnState(
    current,
    backend: runtimeState.backend,
    sessionId: runtimeState.sessionId,
    cwd: runtimeState.cwd,
  );

  return session.copyWith(
    sessionId: runtimeState.sessionId ?? session.sessionId,
    cwd: runtimeState.cwd ?? session.cwd,
    isStreaming: runtimeState.isStreaming,
  );
}

String runtimeChatEventFingerprint(RuntimeEvent event) {
  final parts = <String>[
    event.type,
    event.backend.wireValue,
    event.sessionId ?? '',
    event.cwd ?? '',
    event.messageId ?? '',
    event.toolCallId ?? '',
    event.timestampMs.toString(),
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
      parts.add(_runtimeStringValue(event.input) ?? '');
      break;
    case RuntimeToolUpdatedEvent():
      parts.add(event.toolName ?? '');
      parts.add(_runtimeStringValue(event.partialOutput) ?? '');
      break;
    case RuntimeToolFinishedEvent():
      parts.add(event.toolName ?? '');
      parts.add(_runtimeStringValue(event.output) ?? '');
      parts.add('${event.isError ?? false}');
      break;
    case RuntimeSessionStateChangedEvent():
      parts.add('${event.state.isStreaming}:${event.state.isRetrying}');
      break;
    case RuntimeErrorEvent():
      parts.add(event.message);
      parts.add(event.code ?? '');
      break;
    case RuntimePermissionRequestedEvent():
      parts.add(event.request.requestId ?? '');
      break;
    case RuntimeUserInputRequestedEvent():
      parts.add(event.request.requestId ?? '');
      break;
    case RuntimeCompactionStartedEvent():
      parts.add(event.reason ?? '');
      break;
    case RuntimeCompactionFinishedEvent():
      parts.add(
        '${event.aborted}:${event.willRetry}:${event.errorMessage ?? ''}',
      );
      break;
    case RuntimeRetryStartedEvent():
      parts.add('${event.attempt}:${event.maxAttempts}:${event.delayMs}');
      break;
    case RuntimeRetryFinishedEvent():
      parts.add('${event.attempt}:${event.success}:${event.finalError ?? ''}');
      break;
    case RuntimeBackendEvent():
      parts.add(event.kind);
      break;
    case RuntimeAgentStartedEvent():
    case RuntimeAgentFinishedEvent():
      break;
  }

  return parts.join('|');
}

RuntimeChatTurnState _ensureRuntimeChatTurnState(
  RuntimeChatTurnState? current, {
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

  return RuntimeChatTurnState(
    backend: backend,
    sessionKey: buildRuntimeChatSessionKey(
      backend: backend,
      sessionId: sessionId,
      cwd: cwd,
    ),
    sessionId: sessionId,
    cwd: cwd,
  );
}

RuntimeChatTurnState _rememberRuntimeChatFingerprint(
  RuntimeChatTurnState session,
  String fingerprint,
) {
  final next = [...session.recentEventFingerprints, fingerprint];
  final trimmed = next.length <= _maxRuntimeChatFingerprints
      ? next
      : next.sublist(next.length - _maxRuntimeChatFingerprints);
  return session.copyWith(recentEventFingerprints: trimmed);
}

RuntimeChatTurnState _beginRuntimeTurn(
  RuntimeChatTurnState session,
  String? sourceMessageId,
) {
  final shouldAdvance = session.hasVisibleContent || session.messageId != null;
  final nextTurnIndex = shouldAdvance
      ? session.turnIndex + 1
      : session.turnIndex;
  return RuntimeChatTurnState(
    backend: session.backend,
    sessionKey: session.sessionKey,
    sessionId: session.sessionId,
    cwd: session.cwd,
    messageId: _runtimeMessageId(
      backend: session.backend,
      sessionKey: session.sessionKey,
      turnIndex: nextTurnIndex,
      sourceMessageId: sourceMessageId,
    ),
    isStreaming: true,
    turnIndex: nextTurnIndex,
    recentEventFingerprints: session.recentEventFingerprints,
  );
}

RuntimeChatTurnState _ensureRuntimeTurnIdentity(
  RuntimeChatTurnState session,
  String? sourceMessageId,
) {
  if (session.messageId != null && session.messageId!.isNotEmpty) {
    return session;
  }
  return session.copyWith(
    messageId: _runtimeMessageId(
      backend: session.backend,
      sessionKey: session.sessionKey,
      turnIndex: session.turnIndex,
      sourceMessageId: sourceMessageId,
    ),
  );
}

RuntimeChatTurnState _upsertRuntimeTool(
  RuntimeChatTurnState session, {
  required RuntimeEvent event,
  required String status,
  required Map<String, dynamic> input,
  required String? output,
  Map<String, dynamic>? metadata,
}) {
  final callId = (event.toolCallId ?? '').trim().isEmpty
      ? 'tool-${session.tools.length + 1}'
      : event.toolCallId!.trim();
  final existing = session.tools[callId];
  final toolName = switch (event) {
    RuntimeToolStartedEvent() => event.toolName,
    RuntimeToolUpdatedEvent() => event.toolName,
    RuntimeToolFinishedEvent() => event.toolName,
    _ => null,
  };
  final mergedMetadata = {...?existing?.metadata, ...?metadata};

  final tool =
      (existing ??
              ToolCall(
                callId: callId,
                partId: callId,
                name: (toolName ?? 'tool').trim().isEmpty
                    ? 'tool'
                    : toolName!.trim(),
                status: status,
              ))
          .copyWith(
            status: status,
            title: (toolName ?? '').trim().isEmpty ? null : toolName!.trim(),
            input: input.isEmpty ? (existing?.input ?? const {}) : input,
            output: output,
            metadata: mergedMetadata,
          );

  final tools = {...session.tools, callId: tool};
  final hasPart = session.parts.any(
    (part) => part is ToolPart && part.callId == callId,
  );
  final parts = hasPart
      ? session.parts
      : [
          ..._closeRuntimeTrailingTextPart(session.parts),
          ToolPart(sequence: session.nextPartSequence, callId: callId),
        ];

  return session.copyWith(
    tools: tools,
    parts: parts,
    nextPartSequence: hasPart
        ? session.nextPartSequence
        : session.nextPartSequence + 1,
  );
}

List<MessagePart> _appendRuntimeTextPart(
  List<MessagePart> parts,
  int nextPartSequence,
  String delta,
) {
  final next = [...parts];
  final lastIndex = next.lastIndexWhere((part) => part is TextPart);
  if (lastIndex >= 0 && lastIndex == next.length - 1) {
    final existing = next[lastIndex] as TextPart;
    next[lastIndex] = existing.copyWith(
      text: existing.text + delta,
      isStreaming: true,
    );
    return next;
  }

  next.add(
    TextPart(sequence: nextPartSequence, text: delta, isStreaming: true),
  );
  return next;
}

int _nextRuntimeSequenceForText(List<MessagePart> parts, int nextPartSequence) {
  final lastIndex = parts.lastIndexWhere((part) => part is TextPart);
  return lastIndex >= 0 && lastIndex == parts.length - 1
      ? nextPartSequence
      : nextPartSequence + 1;
}

List<MessagePart> _closeRuntimeTrailingTextPart(List<MessagePart> parts) {
  if (parts.isEmpty) return parts;
  final next = [...parts];
  final last = next.last;
  if (last is TextPart) {
    next[next.length - 1] = last.copyWith(isStreaming: false);
  }
  return next;
}

String _runtimeMessageId({
  required AgentType backend,
  required String sessionKey,
  required int turnIndex,
  String? sourceMessageId,
}) {
  final normalizedSource = (sourceMessageId ?? '').trim();
  if (normalizedSource.isNotEmpty) return normalizedSource;
  return '${backend.wireValue}-runtime-$turnIndex-${sessionKey.hashCode.abs()}';
}

Map<String, dynamic> _runtimeToolInput(Object? value) {
  if (value is Map) {
    return value.map((key, entry) => MapEntry(key.toString(), entry));
  }
  final text = _runtimeStringValue(value);
  if (text == null || text.isEmpty) return const {};
  return {'value': text};
}

String? _runtimeStringValue(Object? value) {
  if (value == null) return null;
  if (value is String) return value;
  try {
    return jsonEncode(value);
  } catch (_) {
    return value.toString();
  }
}
