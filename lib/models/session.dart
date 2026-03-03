import 'session_project.dart';

class SessionSummary {
  const SessionSummary({
    required this.id,
    required this.title,
    required this.projectID,
    required this.directory,
    required this.time,
    this.workspaceID,
    this.slug,
    this.parentID,
    this.summary,
    this.share,
    this.revert,
    this.permission,
    this.project,
  });

  final String id;
  final String title;
  final String projectID;
  final String directory;
  final String? workspaceID; // Workspace association (SDK v1.2.15+)
  final String? slug; // URL-friendly slug for session (SDK v1.1.53+)
  final String? parentID; // For forked sessions
  final SessionTime time;
  final SessionSummaryStats? summary;
  final SessionShare? share; // Share URL if shared
  final SessionRevert? revert; // Active revert state (non-null when reverted)
  final List<Map<String, dynamic>>?
  permission; // Session-level permissions (SDK v1.1.53+)
  final SessionProject?
  project; // Global session list project metadata (SDK v1.2.10+)

  /// Whether this is a background/subagent task (title contains @agent subagent pattern)
  bool get isBackgroundTask {
    if (parentID == null || parentID!.isEmpty) return false;
    final titleLower = title.toLowerCase();
    return titleLower.contains('@agent') ||
        titleLower.contains('subagent') ||
        titleLower.contains('background');
  }

  /// Whether this session was forked from another session (has parent but not a background task)
  bool get isForkedSession {
    if (parentID == null || parentID!.isEmpty) return false;
    return !isBackgroundTask;
  }

  /// Whether this is a root/main session (no parent)
  bool get isRootSession => parentID == null || parentID!.isEmpty;

  /// Whether this has a parent (either forked or background task)
  bool get hasParent => parentID != null && parentID!.isNotEmpty;

  /// Whether this session is shared publicly
  bool get isShared => share != null && share!.url.isNotEmpty;

  /// Whether this session is archived
  bool get isArchived => time.archived != null;

  factory SessionSummary.fromJson(Map<String, dynamic> json) {
    return SessionSummary(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? 'Untitled',
      projectID: json['projectID'] as String? ?? '',
      directory: json['directory'] as String? ?? '',
      workspaceID: json['workspaceID'] as String?,
      slug: json['slug'] as String?,
      parentID: json['parentID'] as String?,
      time: SessionTime.fromJson(
        json['time'] as Map<String, dynamic>? ?? const {},
      ),
      summary: json['summary'] == null
          ? null
          : SessionSummaryStats.fromJson(
              json['summary'] as Map<String, dynamic>,
            ),
      share: json['share'] == null
          ? null
          : SessionShare.fromJson(json['share'] as Map<String, dynamic>),
      revert: json['revert'] == null
          ? null
          : SessionRevert.fromJson(json['revert'] as Map<String, dynamic>),
      permission: (json['permission'] as List<dynamic>?)
          ?.map((p) => p as Map<String, dynamic>)
          .toList(),
      project: json['project'] is Map<String, dynamic>
          ? SessionProject.fromJson(json['project'] as Map<String, dynamic>)
          : null,
    );
  }

  SessionSummary copyWith({
    String? id,
    String? title,
    String? projectID,
    String? directory,
    String? workspaceID,
    String? slug,
    String? parentID,
    SessionTime? time,
    SessionSummaryStats? summary,
    SessionShare? share,
    SessionRevert? revert,
    List<Map<String, dynamic>>? permission,
    SessionProject? project,
  }) {
    return SessionSummary(
      id: id ?? this.id,
      title: title ?? this.title,
      projectID: projectID ?? this.projectID,
      directory: directory ?? this.directory,
      workspaceID: workspaceID ?? this.workspaceID,
      slug: slug ?? this.slug,
      parentID: parentID ?? this.parentID,
      time: time ?? this.time,
      summary: summary ?? this.summary,
      share: share ?? this.share,
      revert: revert ?? this.revert,
      permission: permission ?? this.permission,
      project: project ?? this.project,
    );
  }
}

/// Revert state for a session (non-null when session has been reverted).
///
/// Matches SDK `Session.revert`:
///   `{ messageID: string; partID?: string; snapshot?: string; diff?: string }`
class SessionRevert {
  const SessionRevert({this.messageID, this.partID, this.snapshot, this.diff});

  /// The message ID that was reverted to.
  final String? messageID;

  /// Optional part ID (for per-tool undo).
  final String? partID;

  /// Snapshot state identifier.
  final String? snapshot;

  /// Diff text describing the revert.
  final String? diff;

  /// Whether there is a valid revert in progress.
  bool get isActive => messageID != null && messageID!.isNotEmpty;

  factory SessionRevert.fromJson(Map<String, dynamic> json) {
    return SessionRevert(
      messageID: json['messageID'] as String? ?? json['id'] as String?,
      partID: json['partID'] as String?,
      snapshot: json['snapshot'] as String?,
      diff: json['diff'] as String?,
    );
  }
}

/// Share information for a session
class SessionShare {
  const SessionShare({required this.url});

  final String url;

  factory SessionShare.fromJson(Map<String, dynamic> json) {
    return SessionShare(url: json['url'] as String? ?? '');
  }
}

class SessionTime {
  const SessionTime({
    required this.created,
    required this.updated,
    this.compacting,
    this.archived,
  });

  final int created;
  final int updated;
  final int? compacting;
  final int? archived; // Timestamp when archived, null if not archived

  factory SessionTime.fromJson(Map<String, dynamic> json) {
    return SessionTime(
      created: json['created'] as int? ?? 0,
      updated: json['updated'] as int? ?? 0,
      compacting: json['compacting'] as int?,
      archived: json['archived'] as int?,
    );
  }
}

class SessionSummaryStats {
  const SessionSummaryStats({
    required this.additions,
    required this.deletions,
    required this.files,
    this.diffs,
  });

  final int additions;
  final int deletions;
  final int files;
  final List<SessionDiff>? diffs;

  factory SessionSummaryStats.fromJson(Map<String, dynamic> json) {
    return SessionSummaryStats(
      additions: json['additions'] as int? ?? 0,
      deletions: json['deletions'] as int? ?? 0,
      files: json['files'] as int? ?? 0,
      diffs: (json['diffs'] as List<dynamic>?)
          ?.map((item) => SessionDiff.fromJson(item as Map<String, dynamic>))
          .toList(),
    );
  }
}

class SessionDiff {
  const SessionDiff({
    required this.file,
    required this.before,
    required this.after,
    required this.additions,
    required this.deletions,
    this.status,
  });

  final String file;
  final String before;
  final String after;
  final int additions;
  final int deletions;
  final String? status;

  factory SessionDiff.fromJson(Map<String, dynamic> json) {
    return SessionDiff(
      file: json['file'] as String? ?? '',
      before: json['before'] as String? ?? '',
      after: json['after'] as String? ?? '',
      additions: json['additions'] as int? ?? 0,
      deletions: json['deletions'] as int? ?? 0,
      status: json['status'] as String?,
    );
  }
}

// Feature 13: Session Status
enum SessionStatusType { idle, busy, retry }

class SessionStatus {
  const SessionStatus._({
    required this.type,
    this.attempt,
    this.message,
    this.next,
  });

  final SessionStatusType type;
  final int? attempt; // For retry status
  final String? message; // For retry status
  final int? next; // Timestamp for next retry

  /// Create an idle status
  const SessionStatus.idle() : this._(type: SessionStatusType.idle);

  /// Create a busy status
  const SessionStatus.busy() : this._(type: SessionStatusType.busy);

  /// Create a retry status
  const SessionStatus.retry({
    required int attempt,
    required String message,
    required int next,
  }) : this._(
         type: SessionStatusType.retry,
         attempt: attempt,
         message: message,
         next: next,
       );

  factory SessionStatus.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String? ?? 'idle';
    switch (type) {
      case 'busy':
        return const SessionStatus.busy();
      case 'retry':
        return SessionStatus.retry(
          attempt: json['attempt'] as int? ?? 0,
          message: json['message'] as String? ?? '',
          next: json['next'] as int? ?? 0,
        );
      default:
        return const SessionStatus.idle();
    }
  }

  bool get isIdle => type == SessionStatusType.idle;
  bool get isBusy => type == SessionStatusType.busy;
  bool get isRetry => type == SessionStatusType.retry;

  /// Get a display string for the status
  String get displayString {
    switch (type) {
      case SessionStatusType.idle:
        return 'Idle';
      case SessionStatusType.busy:
        return 'Working...';
      case SessionStatusType.retry:
        return 'Retry ${attempt ?? 0}...';
    }
  }
}
