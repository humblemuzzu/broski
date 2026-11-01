import 'package:broski/models/agent_type.dart';

class RuntimeSessionDiffSummary {
  final int additions;
  final int deletions;
  final int files;

  const RuntimeSessionDiffSummary({
    this.additions = 0,
    this.deletions = 0,
    this.files = 0,
  });

  factory RuntimeSessionDiffSummary.fromJson(Map<String, dynamic> json) {
    return RuntimeSessionDiffSummary(
      additions: (json['additions'] as num?)?.toInt() ?? 0,
      deletions: (json['deletions'] as num?)?.toInt() ?? 0,
      files: (json['files'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {'additions': additions, 'deletions': deletions, 'files': files};
  }
}

class RuntimeSessionSummary {
  final String id;
  final AgentType backend;
  final String title;
  final String cwd;
  final int createdAtMs;
  final int updatedAtMs;
  final bool? isActive;
  final String? modelLabel;
  final RuntimeSessionDiffSummary? summary;
  final String? parentSessionId;
  final int? childSessionCount;
  final String? sessionKind; // "root" | "subagent" | "fork" | "handoff"
  final String? subagentType;
  final Map<String, dynamic>? backendData;

  const RuntimeSessionSummary({
    required this.id,
    required this.backend,
    required this.title,
    required this.cwd,
    required this.createdAtMs,
    required this.updatedAtMs,
    this.isActive,
    this.modelLabel,
    this.summary,
    this.parentSessionId,
    this.childSessionCount,
    this.sessionKind,
    this.subagentType,
    this.backendData,
  });

  /// Whether this is a subagent/task session (created by an agent tool, not the user)
  bool get isSubagentSession => sessionKind == 'subagent';

  /// Whether this is a fork (user-initiated branch of another session)
  bool get isForkedSession => sessionKind == 'fork';

  /// Whether this is a handoff continuation
  bool get isHandoffSession => sessionKind == 'handoff';

  /// Whether this is a root session (user-created, top-level)
  bool get isRootSession => sessionKind == 'root' || sessionKind == null;

  /// Whether this session has children (subagents, forks, or handoffs)
  bool get hasChildren => (childSessionCount ?? 0) > 0;

  /// Whether this session has a parent
  bool get hasParent => parentSessionId != null && parentSessionId!.isNotEmpty;

  factory RuntimeSessionSummary.fromJson(Map<String, dynamic> json) {
    final summaryJson = _asMap(json['summary']);
    return RuntimeSessionSummary(
      id: json['id'] as String? ?? '',
      backend: AgentType.fromWireValue(
        json['backend'] as String? ?? 'claude-code',
      ),
      title: json['title'] as String? ?? '',
      cwd: json['cwd'] as String? ?? '',
      createdAtMs: (json['createdAtMs'] as num?)?.toInt() ?? 0,
      updatedAtMs: (json['updatedAtMs'] as num?)?.toInt() ?? 0,
      isActive: json['isActive'] as bool?,
      modelLabel: json['modelLabel'] as String?,
      summary: summaryJson == null
          ? null
          : RuntimeSessionDiffSummary.fromJson(summaryJson),
      parentSessionId: json['parentSessionId'] as String?,
      childSessionCount: (json['childSessionCount'] as num?)?.toInt(),
      sessionKind: json['sessionKind'] as String?,
      subagentType: json['subagentType'] as String?,
      backendData: _asMap(json['backendData']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'backend': backend.wireValue,
      'title': title,
      'cwd': cwd,
      'createdAtMs': createdAtMs,
      'updatedAtMs': updatedAtMs,
      if (isActive != null) 'isActive': isActive,
      if (modelLabel != null) 'modelLabel': modelLabel,
      if (summary != null) 'summary': summary!.toJson(),
      if (parentSessionId != null) 'parentSessionId': parentSessionId,
      if (childSessionCount != null) 'childSessionCount': childSessionCount,
      if (sessionKind != null) 'sessionKind': sessionKind,
      if (subagentType != null) 'subagentType': subagentType,
      if (backendData != null) 'backendData': backendData,
    };
  }
}

Map<String, dynamic>? _asMap(dynamic value) {
  if (value is! Map) return null;
  return value.map((key, entry) => MapEntry(key.toString(), entry));
}
