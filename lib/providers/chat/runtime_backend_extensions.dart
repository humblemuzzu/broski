import '../../models/agent_type.dart';
import '../../models/message.dart';
import '../chat_provider.dart';
import 'runtime_event_models.dart';
import 'runtime_shadow_state.dart';

RuntimeVisibleSnapshot? buildVisibleRuntimeSnapshot(ChatSessionState state) {
  final backend = _resolveBackend(state);
  final sessionId = state.effectiveSessionId;
  final cwd = state.effectivePath;
  if ((sessionId ?? '').trim().isEmpty && (cwd ?? '').trim().isEmpty) {
    return null;
  }

  final sessionKey = buildRuntimeSessionKey(
    backend: backend,
    sessionId: sessionId,
    cwd: cwd,
  );
  final assistantMessage = _findLatestAssistantMessage(state, sessionId);

  return RuntimeVisibleSnapshot(
    backend: backend,
    sessionKey: sessionKey,
    sessionId: sessionId,
    cwd: cwd,
    isStreaming: _resolveStreamingFlag(state, backend),
    assistantText: assistantMessage?.text ?? '',
    thinkingText: assistantMessage?.reasoningText ?? '',
    toolStatuses: {
      for (final tool in assistantMessage?.toolCalls ?? const <ToolCall>[])
        tool.callId: tool.status,
    },
    permissionPromptCount: state.permissions
        .where((permission) => permission.sessionId == (sessionId ?? ''))
        .length,
  );
}

RuntimeShadowComparison compareShadowToVisible({
  required RuntimeShadowSessionState shadow,
  required RuntimeVisibleSnapshot visible,
}) {
  final shadowSnapshot = shadow.toSnapshot();
  final mismatchFields = <String>[];

  if (shadowSnapshot.isStreaming != visible.isStreaming) {
    mismatchFields.add('isStreaming');
  }
  if (shadowSnapshot.assistantText != visible.assistantText) {
    mismatchFields.add('assistantText');
  }
  if (shadowSnapshot.thinkingText != visible.thinkingText) {
    mismatchFields.add('thinkingText');
  }
  if (!_sameToolStatuses(shadowSnapshot.toolStatuses, visible.toolStatuses)) {
    mismatchFields.add('toolStatuses');
  }
  if (shadowSnapshot.permissionPromptCount != visible.permissionPromptCount) {
    mismatchFields.add('permissionPromptCount');
  }

  return RuntimeShadowComparison(
    comparedAtMs: DateTime.now().millisecondsSinceEpoch,
    visible: visible,
    shadow: shadowSnapshot,
    mismatchFields: mismatchFields,
  );
}

bool canCompareShadowSession({
  required RuntimeShadowSessionState shadow,
  required RuntimeVisibleSnapshot visible,
}) {
  if (shadow.backend != visible.backend) return false;
  return shadow.sessionKey == visible.sessionKey;
}

AgentType _resolveBackend(ChatSessionState state) {
  if (state.isClaudeCode) return AgentType.claudeCode;
  if (state.isCodex) return AgentType.codex;
  if (state.isPi) return AgentType.pi;
  return AgentType.opencode;
}

bool _resolveStreamingFlag(ChatSessionState state, AgentType backend) {
  switch (backend) {
    case AgentType.claudeCode:
      return state.ccIsStreaming;
    case AgentType.codex:
      return state.cxIsStreaming;
    case AgentType.pi:
      return state.piIsStreaming;
    case AgentType.opencode:
      return state.sessionStatus.isBusy || state.sessionStatus.isRetry;
  }
}

ChatMessage? _findLatestAssistantMessage(
  ChatSessionState state,
  String? sessionId,
) {
  if (state.messages.isEmpty) return null;
  for (final message in state.messages.reversed) {
    if (message.role != MessageRole.assistant) continue;
    if ((sessionId ?? '').isNotEmpty && message.sessionId != sessionId) {
      continue;
    }
    return message;
  }
  return null;
}

bool _sameToolStatuses(Map<String, String> left, Map<String, String> right) {
  if (left.length != right.length) return false;
  for (final entry in left.entries) {
    if (right[entry.key] != entry.value) return false;
  }
  return true;
}
