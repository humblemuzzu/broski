/// VCS (Version Control System) information from OpenCode
/// Currently supports Git branch information
class VcsInfo {
  const VcsInfo({this.branch, this.defaultBranch});

  final String? branch;
  final String? defaultBranch;

  /// Whether VCS info is available (in a git repo)
  bool get isAvailable => branch != null && branch!.isNotEmpty;

  /// Whether current branch differs from the default branch
  bool get isOnFeatureBranch =>
      isAvailable && defaultBranch != null && branch != defaultBranch;

  factory VcsInfo.fromJson(Map<String, dynamic> json) {
    return VcsInfo(
      branch: json['branch'] as String?,
      defaultBranch: json['default_branch'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (branch != null) 'branch': branch,
      if (defaultBranch != null) 'default_branch': defaultBranch,
    };
  }

  VcsInfo copyWith({String? branch, String? defaultBranch}) {
    return VcsInfo(
      branch: branch ?? this.branch,
      defaultBranch: defaultBranch ?? this.defaultBranch,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is VcsInfo &&
          runtimeType == other.runtimeType &&
          branch == other.branch &&
          defaultBranch == other.defaultBranch;

  @override
  int get hashCode => Object.hash(branch, defaultBranch);

  @override
  String toString() =>
      'VcsInfo(branch: $branch, defaultBranch: $defaultBranch)';
}

// Feature 18: File Status (Git)
/// Status of a file in version control
enum FileStatusType {
  modified,
  added,
  deleted,
  renamed,
  copied,
  untracked,
  ignored,
}

/// Represents the git status of a file
class FileStatusInfo {
  final String path;
  final FileStatusType status;
  final int added;
  final int removed;

  const FileStatusInfo({
    required this.path,
    required this.status,
    required this.added,
    required this.removed,
  });

  factory FileStatusInfo.fromJson(Map<String, dynamic> json) {
    return FileStatusInfo(
      path: json['path'] as String? ?? '',
      status: _parseStatus(json['status'] as String? ?? 'modified'),
      added: json['added'] is int ? json['added'] as int : 0,
      removed: json['removed'] is int ? json['removed'] as int : 0,
    );
  }

  static FileStatusType _parseStatus(String s) {
    switch (s.toLowerCase()) {
      case 'added':
        return FileStatusType.added;
      case 'deleted':
        return FileStatusType.deleted;
      case 'renamed':
        return FileStatusType.renamed;
      case 'copied':
        return FileStatusType.copied;
      case 'untracked':
        return FileStatusType.untracked;
      case 'ignored':
        return FileStatusType.ignored;
      default:
        return FileStatusType.modified;
    }
  }

  /// Get the filename from the path
  String get filename => path.split('/').last;

  /// Get display label for status
  String get statusLabel {
    switch (status) {
      case FileStatusType.modified:
        return 'M';
      case FileStatusType.added:
        return 'A';
      case FileStatusType.deleted:
        return 'D';
      case FileStatusType.renamed:
        return 'R';
      case FileStatusType.copied:
        return 'C';
      case FileStatusType.untracked:
        return '?';
      case FileStatusType.ignored:
        return '!';
    }
  }

  /// Get description for status
  String get statusDescription {
    switch (status) {
      case FileStatusType.modified:
        return 'Modified';
      case FileStatusType.added:
        return 'Added';
      case FileStatusType.deleted:
        return 'Deleted';
      case FileStatusType.renamed:
        return 'Renamed';
      case FileStatusType.copied:
        return 'Copied';
      case FileStatusType.untracked:
        return 'Untracked';
      case FileStatusType.ignored:
        return 'Ignored';
    }
  }
}

// Feature 19: Formatter Status (matches SDK FormatterStatus shape)
/// Information about a code formatter
class FormatterInfo {
  final String name;
  final List<String> extensions;
  final bool enabled;

  const FormatterInfo({
    required this.name,
    this.extensions = const [],
    required this.enabled,
  });

  factory FormatterInfo.fromJson(Map<String, dynamic> json) {
    return FormatterInfo(
      name: json['name'] as String? ?? '',
      extensions:
          (json['extensions'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
      enabled: json['enabled'] as bool? ?? false,
    );
  }

  /// Display string for supported extensions
  String get extensionDisplay =>
      extensions.isEmpty ? 'No extensions' : extensions.join(', ');
}

/// A file-level diff from OpenCode's vcs.diff() endpoint.
/// Contains full before/after content and line-change counts.
class VcsDiffFile {
  final String file;
  final String before;
  final String after;
  final int additions;
  final int deletions;
  final String? status; // "added" | "deleted" | "modified"

  const VcsDiffFile({
    required this.file,
    this.before = '',
    this.after = '',
    this.additions = 0,
    this.deletions = 0,
    this.status,
  });

  factory VcsDiffFile.fromJson(Map<String, dynamic> json) {
    return VcsDiffFile(
      file: json['file'] as String? ?? '',
      before: json['before'] as String? ?? '',
      after: json['after'] as String? ?? '',
      additions: json['additions'] as int? ?? 0,
      deletions: json['deletions'] as int? ?? 0,
      status: json['status'] as String?,
    );
  }

  /// Just the filename, without directory path
  String get filename => file.split('/').last;

  /// Short status label: A, D, M, or ?
  String get statusLabel => switch (status) {
    'added' => 'A',
    'deleted' => 'D',
    'modified' => 'M',
    _ => '?',
  };

  bool get isAdded => status == 'added';
  bool get isDeleted => status == 'deleted';
  bool get isModified => status == 'modified';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is VcsDiffFile &&
          runtimeType == other.runtimeType &&
          file == other.file &&
          status == other.status;

  @override
  int get hashCode => Object.hash(file, status);

  @override
  String toString() =>
      'VcsDiffFile($statusLabel $file +$additions -$deletions)';
}
