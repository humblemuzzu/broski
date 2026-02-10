enum GitChangeStatus { modified, added, deleted, renamed, copied }

enum GitHubItemState { open, closed, all }

GitChangeStatus gitChangeStatusFromWireValue(String? value) {
  switch ((value ?? '').toLowerCase()) {
    case 'added':
      return GitChangeStatus.added;
    case 'deleted':
      return GitChangeStatus.deleted;
    case 'renamed':
      return GitChangeStatus.renamed;
    case 'copied':
      return GitChangeStatus.copied;
    default:
      return GitChangeStatus.modified;
  }
}

GitHubItemState gitHubItemStateFromWireValue(String? value) {
  switch ((value ?? '').toLowerCase()) {
    case 'closed':
      return GitHubItemState.closed;
    case 'all':
      return GitHubItemState.all;
    default:
      return GitHubItemState.open;
  }
}

extension GitChangeStatusX on GitChangeStatus {
  String get wireValue {
    switch (this) {
      case GitChangeStatus.modified:
        return 'modified';
      case GitChangeStatus.added:
        return 'added';
      case GitChangeStatus.deleted:
        return 'deleted';
      case GitChangeStatus.renamed:
        return 'renamed';
      case GitChangeStatus.copied:
        return 'copied';
    }
  }

  String get shortLabel {
    switch (this) {
      case GitChangeStatus.modified:
        return 'M';
      case GitChangeStatus.added:
        return 'A';
      case GitChangeStatus.deleted:
        return 'D';
      case GitChangeStatus.renamed:
        return 'R';
      case GitChangeStatus.copied:
        return 'C';
    }
  }

  String get displayName {
    switch (this) {
      case GitChangeStatus.modified:
        return 'Modified';
      case GitChangeStatus.added:
        return 'Added';
      case GitChangeStatus.deleted:
        return 'Deleted';
      case GitChangeStatus.renamed:
        return 'Renamed';
      case GitChangeStatus.copied:
        return 'Copied';
    }
  }
}

extension GitHubItemStateX on GitHubItemState {
  String get wireValue {
    switch (this) {
      case GitHubItemState.open:
        return 'open';
      case GitHubItemState.closed:
        return 'closed';
      case GitHubItemState.all:
        return 'all';
    }
  }

  String get displayName {
    switch (this) {
      case GitHubItemState.open:
        return 'Open';
      case GitHubItemState.closed:
        return 'Closed';
      case GitHubItemState.all:
        return 'All';
    }
  }
}

class GitFileChange {
  const GitFileChange({
    required this.path,
    required this.status,
    this.oldPath,
    this.additions,
    this.deletions,
  });

  final String path;
  final GitChangeStatus status;
  final String? oldPath;
  final int? additions;
  final int? deletions;

  String get fileName => path.split('/').last;

  factory GitFileChange.fromJson(Map<String, dynamic> json) {
    return GitFileChange(
      path: json['path'] as String? ?? '',
      status: gitChangeStatusFromWireValue(json['status'] as String?),
      oldPath: json['oldPath'] as String?,
      additions: json['additions'] is int ? json['additions'] as int : null,
      deletions: json['deletions'] is int ? json['deletions'] as int : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'path': path,
    'status': status.wireValue,
    if (oldPath != null) 'oldPath': oldPath,
    if (additions != null) 'additions': additions,
    if (deletions != null) 'deletions': deletions,
  };
}

class GitStatusResult {
  const GitStatusResult({
    required this.branch,
    required this.upstream,
    required this.ahead,
    required this.behind,
    required this.staged,
    required this.unstaged,
    required this.untracked,
  });

  final String branch;
  final String? upstream;
  final int ahead;
  final int behind;
  final List<GitFileChange> staged;
  final List<GitFileChange> unstaged;
  final List<String> untracked;

  int get changedFileCount =>
      staged.length + unstaged.length + untracked.length;

  factory GitStatusResult.fromJson(Map<String, dynamic> json) {
    final stagedRaw = json['staged'] as List<dynamic>? ?? const [];
    final unstagedRaw = json['unstaged'] as List<dynamic>? ?? const [];
    final untrackedRaw = json['untracked'] as List<dynamic>? ?? const [];

    return GitStatusResult(
      branch: json['branch'] as String? ?? '',
      upstream: json['upstream'] as String?,
      ahead: json['ahead'] is int ? json['ahead'] as int : 0,
      behind: json['behind'] is int ? json['behind'] as int : 0,
      staged: stagedRaw
          .whereType<Map>()
          .map((item) => GitFileChange.fromJson(item.cast<String, dynamic>()))
          .toList(),
      unstaged: unstagedRaw
          .whereType<Map>()
          .map((item) => GitFileChange.fromJson(item.cast<String, dynamic>()))
          .toList(),
      untracked: untrackedRaw.map((item) => item.toString()).toList(),
    );
  }
}

class GitLogEntry {
  const GitLogEntry({
    required this.hash,
    required this.shortHash,
    required this.author,
    required this.email,
    required this.timestamp,
    required this.subject,
  });

  final String hash;
  final String shortHash;
  final String author;
  final String email;
  final DateTime timestamp;
  final String subject;

  factory GitLogEntry.fromJson(Map<String, dynamic> json) {
    final unixSeconds = json['timestamp'] is int ? json['timestamp'] as int : 0;
    return GitLogEntry(
      hash: json['hash'] as String? ?? '',
      shortHash: json['shortHash'] as String? ?? '',
      author: json['author'] as String? ?? '',
      email: json['email'] as String? ?? '',
      timestamp: DateTime.fromMillisecondsSinceEpoch(
        unixSeconds * 1000,
      ).toLocal(),
      subject: json['subject'] as String? ?? '',
    );
  }
}

class GitBranch {
  const GitBranch({
    required this.name,
    required this.upstream,
    required this.tracking,
    required this.isCurrent,
    required this.isRemote,
  });

  final String name;
  final String? upstream;
  final String? tracking;
  final bool isCurrent;
  final bool isRemote;

  factory GitBranch.fromJson(Map<String, dynamic> json) {
    return GitBranch(
      name: json['name'] as String? ?? '',
      upstream: json['upstream'] as String?,
      tracking: json['tracking'] as String?,
      isCurrent: json['isCurrent'] as bool? ?? false,
      isRemote: json['isRemote'] as bool? ?? false,
    );
  }
}

class GitCommitResult {
  const GitCommitResult({required this.hash, required this.subject});

  final String hash;
  final String subject;

  factory GitCommitResult.fromJson(Map<String, dynamic> json) {
    return GitCommitResult(
      hash: json['hash'] as String? ?? '',
      subject: json['subject'] as String? ?? '',
    );
  }
}

class GitHubRemote {
  const GitHubRemote({
    required this.owner,
    required this.repo,
    required this.host,
  });

  final String owner;
  final String repo;
  final String host;

  String get fullName => '$owner/$repo';

  factory GitHubRemote.fromJson(Map<String, dynamic> json) {
    return GitHubRemote(
      owner: json['owner'] as String? ?? '',
      repo: json['repo'] as String? ?? '',
      host: json['host'] as String? ?? 'github.com',
    );
  }
}

class GitHubIssue {
  const GitHubIssue({
    required this.number,
    required this.title,
    required this.state,
    required this.author,
    required this.createdAt,
    required this.labels,
    this.body,
  });

  final int number;
  final String title;
  final String state;
  final String author;
  final DateTime createdAt;
  final List<String> labels;
  final String? body;

  factory GitHubIssue.fromJson(Map<String, dynamic> json) {
    final labelsRaw = json['labels'] as List<dynamic>? ?? const [];
    return GitHubIssue(
      number: json['number'] is int ? json['number'] as int : 0,
      title: json['title'] as String? ?? '',
      state: json['state'] as String? ?? 'open',
      author: json['author'] as String? ?? '',
      createdAt:
          DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
      labels: labelsRaw.map((item) => item.toString()).toList(),
      body: json['body'] as String?,
    );
  }
}

class GitHubPR {
  const GitHubPR({
    required this.number,
    required this.title,
    required this.state,
    required this.author,
    required this.headBranch,
    required this.baseBranch,
    required this.createdAt,
    required this.isDraft,
    required this.isMerged,
  });

  final int number;
  final String title;
  final String state;
  final String author;
  final String headBranch;
  final String baseBranch;
  final DateTime createdAt;
  final bool isDraft;
  final bool isMerged;

  factory GitHubPR.fromJson(Map<String, dynamic> json) {
    return GitHubPR(
      number: json['number'] is int ? json['number'] as int : 0,
      title: json['title'] as String? ?? '',
      state: json['state'] as String? ?? 'open',
      author: json['author'] as String? ?? '',
      headBranch: json['headBranch'] as String? ?? '',
      baseBranch: json['baseBranch'] as String? ?? '',
      createdAt:
          DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
      isDraft: json['isDraft'] as bool? ?? false,
      isMerged: json['isMerged'] as bool? ?? false,
    );
  }
}

class GitHubComment {
  const GitHubComment({
    required this.author,
    required this.body,
    required this.createdAt,
    this.path,
    this.line,
  });

  final String author;
  final String body;
  final String? path;
  final int? line;
  final DateTime createdAt;

  factory GitHubComment.fromJson(Map<String, dynamic> json) {
    return GitHubComment(
      author: json['author'] as String? ?? '',
      body: json['body'] as String? ?? '',
      path: json['path'] as String?,
      line: json['line'] is int ? json['line'] as int : null,
      createdAt:
          DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
    );
  }
}
