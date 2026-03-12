import '../session.dart' show SessionSummaryStats;

class ClaudeCodeSession {
  final String id;
  final String? title;
  final String cwd;
  final String? model;
  final int createdAt;
  final int updatedAt;
  final int? messageCount;
  final bool isBackground;
  final bool hasSubagentActivity;
  final String? subagentName;
  final SessionSummaryStats? summary;
  final String? gitBranch;

  const ClaudeCodeSession({
    required this.id,
    this.title,
    required this.cwd,
    this.model,
    required this.createdAt,
    required this.updatedAt,
    this.messageCount,
    this.isBackground = false,
    this.hasSubagentActivity = false,
    this.subagentName,
    this.summary,
    this.gitBranch,
  });

  factory ClaudeCodeSession.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeSession(
      id: json['id'] as String? ?? '',
      title: json['title'] as String?,
      cwd: json['cwd'] as String? ?? '',
      model: json['model'] as String?,
      createdAt: json['createdAt'] as int? ?? 0,
      updatedAt: json['updatedAt'] as int? ?? 0,
      messageCount: json['messageCount'] as int?,
      isBackground: json['isBackground'] as bool? ?? false,
      hasSubagentActivity: json['hasSubagentActivity'] as bool? ?? false,
      subagentName: json['subagentName'] as String?,
      summary: json['summary'] == null
          ? null
          : SessionSummaryStats.fromJson(
              json['summary'] as Map<String, dynamic>,
            ),
      gitBranch: json['gitBranch'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      if (title != null) 'title': title,
      'cwd': cwd,
      if (model != null) 'model': model,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
      if (messageCount != null) 'messageCount': messageCount,
      if (isBackground) 'isBackground': isBackground,
      if (hasSubagentActivity) 'hasSubagentActivity': hasSubagentActivity,
      if (subagentName != null) 'subagentName': subagentName,
      if (gitBranch != null) 'gitBranch': gitBranch,
    };
  }

  String get displayTitle => title ?? 'Session ${id.substring(0, 8)}';

  bool get isSubagentSession => isBackground || hasSubagentActivity;

  DateTime get createdAtDateTime =>
      DateTime.fromMillisecondsSinceEpoch(createdAt);
  DateTime get updatedAtDateTime =>
      DateTime.fromMillisecondsSinceEpoch(updatedAt);
}
