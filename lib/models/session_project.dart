class SessionProject {
  const SessionProject({required this.id, this.name, required this.worktree});

  final String id;
  final String? name;
  final String worktree;

  factory SessionProject.fromJson(Map<String, dynamic> json) {
    return SessionProject(
      id: json['id'] as String? ?? '',
      name: json['name'] as String?,
      worktree: json['worktree'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {'id': id, if (name != null) 'name': name, 'worktree': worktree};
  }

  SessionProject copyWith({String? id, String? name, String? worktree}) {
    return SessionProject(
      id: id ?? this.id,
      name: name ?? this.name,
      worktree: worktree ?? this.worktree,
    );
  }
}
