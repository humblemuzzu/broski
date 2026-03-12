class ProjectSummary {
  const ProjectSummary({
    required this.id,
    required this.name,
    required this.path,
    this.icon,
    this.lastOpened,
  });

  final String id;
  final String name;
  final String path;
  final String? icon;
  final int? lastOpened;

  factory ProjectSummary.fromJson(Map<String, dynamic> json) {
    return ProjectSummary(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      path: json['path'] as String? ?? '',
      icon: json['icon'] as String?,
      lastOpened: json['lastOpened'] as int?,
    );
  }
}
