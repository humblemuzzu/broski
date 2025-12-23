class SessionSummary {
  const SessionSummary({
    required this.id,
    required this.title,
    required this.projectID,
    required this.directory,
    required this.time,
    this.summary,
  });

  final String id;
  final String title;
  final String projectID;
  final String directory;
  final SessionTime time;
  final SessionSummaryStats? summary;

  factory SessionSummary.fromJson(Map<String, dynamic> json) {
    return SessionSummary(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? 'Untitled',
      projectID: json['projectID'] as String? ?? '',
      directory: json['directory'] as String? ?? '',
      time: SessionTime.fromJson(json['time'] as Map<String, dynamic>? ?? const {}),
      summary: json['summary'] == null
          ? null
          : SessionSummaryStats.fromJson(json['summary'] as Map<String, dynamic>),
    );
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
