class SessionSummary {
  const SessionSummary({
    required this.id,
    required this.title,
    required this.projectID,
    required this.directory,
    required this.time,
    this.parentID,
    this.summary,
    this.share,
  });

  final String id;
  final String title;
  final String projectID;
  final String directory;
  final String? parentID; // For forked sessions
  final SessionTime time;
  final SessionSummaryStats? summary;
  final SessionShare? share; // Share URL if shared

  /// Whether this session was forked from another session
  bool get isForked => parentID != null && parentID!.isNotEmpty;

  /// Whether this is a background/subagent session (has a parent)
  bool get isBackgroundTask => parentID != null && parentID!.isNotEmpty;

  /// Whether this is a root/main session (no parent)
  bool get isRootSession => parentID == null || parentID!.isEmpty;

  /// Whether this session is shared publicly
  bool get isShared => share != null && share!.url.isNotEmpty;

  factory SessionSummary.fromJson(Map<String, dynamic> json) {
    return SessionSummary(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? 'Untitled',
      projectID: json['projectID'] as String? ?? '',
      directory: json['directory'] as String? ?? '',
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
    );
  }

  SessionSummary copyWith({
    String? id,
    String? title,
    String? projectID,
    String? directory,
    String? parentID,
    SessionTime? time,
    SessionSummaryStats? summary,
    SessionShare? share,
  }) {
    return SessionSummary(
      id: id ?? this.id,
      title: title ?? this.title,
      projectID: projectID ?? this.projectID,
      directory: directory ?? this.directory,
      parentID: parentID ?? this.parentID,
      time: time ?? this.time,
      summary: summary ?? this.summary,
      share: share ?? this.share,
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
  });

  final int created;
  final int updated;
  final int? compacting;

  factory SessionTime.fromJson(Map<String, dynamic> json) {
    return SessionTime(
      created: json['created'] as int? ?? 0,
      updated: json['updated'] as int? ?? 0,
      compacting: json['compacting'] as int?,
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
  });

  final String file;
  final String before;
  final String after;
  final int additions;
  final int deletions;

  factory SessionDiff.fromJson(Map<String, dynamic> json) {
    return SessionDiff(
      file: json['file'] as String? ?? '',
      before: json['before'] as String? ?? '',
      after: json['after'] as String? ?? '',
      additions: json['additions'] as int? ?? 0,
      deletions: json['deletions'] as int? ?? 0,
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
