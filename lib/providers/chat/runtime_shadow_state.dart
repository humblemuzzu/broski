import 'runtime_event_models.dart';
import '../../models/agent_type.dart';

class RuntimeShadowSessionState {
  const RuntimeShadowSessionState({
    required this.backend,
    required this.sessionKey,
    this.sessionId,
    this.cwd,
    this.isStreaming = false,
    this.assistantText = '',
    this.thinkingText = '',
    this.tools = const {},
    this.permissionPromptCount = 0,
    this.recentEventFingerprints = const [],
    this.seenPermissionRequestIds = const [],
    this.revision = 0,
    this.lastUpdatedAtMs = 0,
  });

  final AgentType backend;
  final String sessionKey;
  final String? sessionId;
  final String? cwd;
  final bool isStreaming;
  final String assistantText;
  final String thinkingText;
  final Map<String, RuntimeShadowToolState> tools;
  final int permissionPromptCount;
  final List<String> recentEventFingerprints;
  final List<String> seenPermissionRequestIds;
  final int revision;
  final int lastUpdatedAtMs;

  RuntimeShadowSessionState copyWith({
    String? sessionId,
    String? cwd,
    bool? isStreaming,
    String? assistantText,
    String? thinkingText,
    Map<String, RuntimeShadowToolState>? tools,
    int? permissionPromptCount,
    List<String>? recentEventFingerprints,
    List<String>? seenPermissionRequestIds,
    int? revision,
    int? lastUpdatedAtMs,
  }) {
    return RuntimeShadowSessionState(
      backend: backend,
      sessionKey: sessionKey,
      sessionId: sessionId ?? this.sessionId,
      cwd: cwd ?? this.cwd,
      isStreaming: isStreaming ?? this.isStreaming,
      assistantText: assistantText ?? this.assistantText,
      thinkingText: thinkingText ?? this.thinkingText,
      tools: tools ?? this.tools,
      permissionPromptCount:
          permissionPromptCount ?? this.permissionPromptCount,
      recentEventFingerprints:
          recentEventFingerprints ?? this.recentEventFingerprints,
      seenPermissionRequestIds:
          seenPermissionRequestIds ?? this.seenPermissionRequestIds,
      revision: revision ?? this.revision,
      lastUpdatedAtMs: lastUpdatedAtMs ?? this.lastUpdatedAtMs,
    );
  }

  RuntimeShadowSessionSnapshot toSnapshot() {
    return RuntimeShadowSessionSnapshot(
      backend: backend,
      sessionKey: sessionKey,
      sessionId: sessionId,
      cwd: cwd,
      isStreaming: isStreaming,
      assistantText: assistantText,
      thinkingText: thinkingText,
      toolStatuses: {
        for (final entry in tools.entries) entry.key: entry.value.status,
      },
      permissionPromptCount: permissionPromptCount,
    );
  }
}

class RuntimeShadowState {
  const RuntimeShadowState({
    this.sessions = const {},
    this.latestComparison,
    this.recentMismatches = const [],
    this.metrics = const RuntimeShadowMetrics(),
    this.lastComparisonFingerprint,
    this.lastResetReason,
  });

  final Map<String, RuntimeShadowSessionState> sessions;
  final RuntimeShadowComparison? latestComparison;
  final List<RuntimeShadowComparison> recentMismatches;
  final RuntimeShadowMetrics metrics;
  final String? lastComparisonFingerprint;
  final String? lastResetReason;

  RuntimeShadowState copyWith({
    Map<String, RuntimeShadowSessionState>? sessions,
    RuntimeShadowComparison? latestComparison,
    bool clearLatestComparison = false,
    List<RuntimeShadowComparison>? recentMismatches,
    RuntimeShadowMetrics? metrics,
    String? lastComparisonFingerprint,
    bool clearLastComparisonFingerprint = false,
    String? lastResetReason,
  }) {
    return RuntimeShadowState(
      sessions: sessions ?? this.sessions,
      latestComparison: clearLatestComparison
          ? null
          : (latestComparison ?? this.latestComparison),
      recentMismatches: recentMismatches ?? this.recentMismatches,
      metrics: metrics ?? this.metrics,
      lastComparisonFingerprint: clearLastComparisonFingerprint
          ? null
          : (lastComparisonFingerprint ?? this.lastComparisonFingerprint),
      lastResetReason: lastResetReason ?? this.lastResetReason,
    );
  }
}
