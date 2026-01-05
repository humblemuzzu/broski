/// Git Worktree (SDK v1.1.1+ experimental feature)
/// Represents a git worktree for a project
class Worktree {
  final String name;
  final String branch;
  final String directory;

  const Worktree({
    required this.name,
    required this.branch,
    required this.directory,
  });

  factory Worktree.fromJson(Map<String, dynamic> json) {
    return Worktree(
      name: json['name'] as String? ?? '',
      branch: json['branch'] as String? ?? '',
      directory: json['directory'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    'branch': branch,
    'directory': directory,
  };

  /// Check if this is the main worktree (no separate branch)
  bool get isMain => branch.isEmpty || branch == 'main' || branch == 'master';

  /// Get a display name (branch name or directory name)
  String get displayName {
    if (name.isNotEmpty) return name;
    if (branch.isNotEmpty) return branch;
    final parts = directory.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'worktree' : parts.last;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Worktree &&
          runtimeType == other.runtimeType &&
          name == other.name &&
          directory == other.directory;

  @override
  int get hashCode => Object.hash(name, directory);
}

/// Input for creating a new worktree
class WorktreeCreateInput {
  final String? name;
  final String? startCommand;

  const WorktreeCreateInput({this.name, this.startCommand});

  Map<String, dynamic> toJson() => {
    if (name != null) 'name': name,
    if (startCommand != null) 'startCommand': startCommand,
  };
}
