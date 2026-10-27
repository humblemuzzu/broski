import 'package:broski/models/session.dart' show SessionSummaryStats;
import 'package:broski/utils/ansi_escape.dart';

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
  final String? parentSessionId;
  final int? subagentCount;
  final SessionSummaryStats? summary;
  final String? gitBranch;
  final String? customTitle;
  final String? firstPrompt;
  final String? tag;
  final int? fileSize;

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
    this.parentSessionId,
    this.subagentCount,
    this.summary,
    this.gitBranch,
    this.customTitle,
    this.firstPrompt,
    this.tag,
    this.fileSize,
  });

  factory ClaudeCodeSession.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeSession(
      id: json['id'] as String? ?? '',
      title: _text(json['title']),
      cwd: json['cwd'] as String? ?? '',
      model: json['model'] as String?,
      createdAt: json['createdAt'] as int? ?? 0,
      updatedAt: json['updatedAt'] as int? ?? 0,
      messageCount: json['messageCount'] as int?,
      isBackground: json['isBackground'] as bool? ?? false,
      hasSubagentActivity: json['hasSubagentActivity'] as bool? ?? false,
      subagentName: json['subagentName'] as String?,
      parentSessionId: json['parentSessionId'] as String?,
      subagentCount: (json['subagentCount'] as num?)?.toInt(),
      summary: json['summary'] == null
          ? null
          : SessionSummaryStats.fromJson(
              json['summary'] as Map<String, dynamic>,
            ),
      gitBranch: json['gitBranch'] as String?,
      customTitle: _text(json['customTitle']),
      firstPrompt: _text(json['firstPrompt']),
      tag: json['tag'] as String?,
      fileSize: (json['fileSize'] as num?)?.toInt(),
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
      if (parentSessionId != null) 'parentSessionId': parentSessionId,
      if (subagentCount != null) 'subagentCount': subagentCount,
      if (gitBranch != null) 'gitBranch': gitBranch,
      if (customTitle != null) 'customTitle': customTitle,
      if (firstPrompt != null) 'firstPrompt': firstPrompt,
      if (tag != null) 'tag': tag,
      if (fileSize != null) 'fileSize': fileSize,
    };
  }

  /// A row's title and preview are display text: a provider's colour codes are not shown.
  static String? _text(Object? value) =>
      value is String && value.isNotEmpty ? stripAnsi(value) : value as String?;

  /// Display title: prefer user-set customTitle, then auto-generated title, then fallback.
  String get displayTitle =>
      customTitle ?? title ?? 'Session ${id.substring(0, 8)}';

  /// Whether this session IS a subagent (child of another session)
  bool get isSubagentSession =>
      isBackground && parentSessionId != null && parentSessionId!.isNotEmpty;

  /// Whether this session HAS subagent children
  bool get hasChildren => (subagentCount ?? 0) > 0 || hasSubagentActivity;

  DateTime get createdAtDateTime =>
      DateTime.fromMillisecondsSinceEpoch(createdAt);
  DateTime get updatedAtDateTime =>
      DateTime.fromMillisecondsSinceEpoch(updatedAt);
}
