import 'package:broski/models/agent_type.dart';

class RuntimeShadowToolState {
  const RuntimeShadowToolState({
    required this.callId,
    required this.name,
    required this.status,
    this.input,
    this.output,
  });

  final String callId;
  final String name;
  final String status;
  final Map<String, dynamic>? input;
  final String? output;

  RuntimeShadowToolState copyWith({
    String? name,
    String? status,
    Map<String, dynamic>? input,
    String? output,
    bool clearOutput = false,
  }) {
    return RuntimeShadowToolState(
      callId: callId,
      name: name ?? this.name,
      status: status ?? this.status,
      input: input ?? this.input,
      output: clearOutput ? null : (output ?? this.output),
    );
  }
}

class RuntimeShadowSessionSnapshot {
  const RuntimeShadowSessionSnapshot({
    required this.backend,
    required this.sessionKey,
    this.sessionId,
    this.cwd,
    required this.isStreaming,
    required this.assistantText,
    required this.thinkingText,
    required this.toolStatuses,
    required this.permissionPromptCount,
  });

  final AgentType backend;
  final String sessionKey;
  final String? sessionId;
  final String? cwd;
  final bool isStreaming;
  final String assistantText;
  final String thinkingText;
  final Map<String, String> toolStatuses;
  final int permissionPromptCount;

  String get fingerprint => [
    backend.wireValue,
    sessionKey,
    isStreaming.toString(),
    assistantText,
    thinkingText,
    permissionPromptCount.toString(),
    ...toolStatuses.entries.map((entry) => '${entry.key}:${entry.value}'),
  ].join('|');
}

class RuntimeVisibleSnapshot {
  const RuntimeVisibleSnapshot({
    required this.backend,
    required this.sessionKey,
    this.sessionId,
    this.cwd,
    required this.isStreaming,
    required this.assistantText,
    required this.thinkingText,
    required this.toolStatuses,
    required this.permissionPromptCount,
  });

  final AgentType backend;
  final String sessionKey;
  final String? sessionId;
  final String? cwd;
  final bool isStreaming;
  final String assistantText;
  final String thinkingText;
  final Map<String, String> toolStatuses;
  final int permissionPromptCount;

  String get fingerprint => [
    backend.wireValue,
    sessionKey,
    isStreaming.toString(),
    assistantText,
    thinkingText,
    permissionPromptCount.toString(),
    ...toolStatuses.entries.map((entry) => '${entry.key}:${entry.value}'),
  ].join('|');
}

class RuntimeShadowComparison {
  const RuntimeShadowComparison({
    required this.comparedAtMs,
    required this.visible,
    required this.shadow,
    required this.mismatchFields,
  });

  final int comparedAtMs;
  final RuntimeVisibleSnapshot visible;
  final RuntimeShadowSessionSnapshot shadow;
  final List<String> mismatchFields;

  bool get isMatch => mismatchFields.isEmpty;

  String get fingerprint =>
      '$comparedAtMs|${visible.fingerprint}|${shadow.fingerprint}';
}

class RuntimeShadowMetrics {
  const RuntimeShadowMetrics({
    this.totalComparisons = 0,
    this.matchCount = 0,
    this.mismatchCount = 0,
  });

  final int totalComparisons;
  final int matchCount;
  final int mismatchCount;

  RuntimeShadowMetrics copyWith({
    int? totalComparisons,
    int? matchCount,
    int? mismatchCount,
  }) {
    return RuntimeShadowMetrics(
      totalComparisons: totalComparisons ?? this.totalComparisons,
      matchCount: matchCount ?? this.matchCount,
      mismatchCount: mismatchCount ?? this.mismatchCount,
    );
  }
}

String buildRuntimeSessionKey({
  required AgentType backend,
  String? sessionId,
  String? cwd,
}) {
  final normalizedSessionId = (sessionId ?? '').trim();
  if (normalizedSessionId.isNotEmpty) {
    return '${backend.wireValue}::$normalizedSessionId';
  }

  final normalizedCwd = (cwd ?? '').trim();
  if (normalizedCwd.isNotEmpty) {
    return '${backend.wireValue}::cwd::$normalizedCwd';
  }

  return '${backend.wireValue}::unknown';
}
