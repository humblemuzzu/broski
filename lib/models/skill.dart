import 'agent_type.dart';

enum SkillSource {
  project,
  user,
  builtin,
  system,
  admin,
  plugin;

  static SkillSource fromWire(String? v) {
    switch (v) {
      case 'project':
        return SkillSource.project;
      case 'user':
        return SkillSource.user;
      case 'admin':
        return SkillSource.admin;
      case 'plugin':
        return SkillSource.plugin;
      case 'builtin':
      case 'sdk':
        return SkillSource.builtin;
      case 'system':
      default:
        return SkillSource.system;
    }
  }

  String get wireValue => name;

  bool get isEditable =>
      this == SkillSource.project || this == SkillSource.user;

  String get displayName {
    switch (this) {
      case SkillSource.project:
        return 'Project';
      case SkillSource.user:
        return 'User';
      case SkillSource.builtin:
        return 'Built-in';
      case SkillSource.system:
        return 'System';
      case SkillSource.admin:
        return 'Admin';
      case SkillSource.plugin:
        return 'Plugin';
    }
  }
}

class Skill {
  final AgentType backend;
  final String name;
  final String? description;
  final SkillSource source;
  final String path;
  final String? content;
  final Map<String, dynamic>? extra;

  const Skill({
    required this.backend,
    required this.name,
    this.description,
    required this.source,
    required this.path,
    this.content,
    this.extra,
  });

  Skill copyWith({
    AgentType? backend,
    String? name,
    String? description,
    SkillSource? source,
    String? path,
    String? content,
    Map<String, dynamic>? extra,
  }) {
    return Skill(
      backend: backend ?? this.backend,
      name: name ?? this.name,
      description: description ?? this.description,
      source: source ?? this.source,
      path: path ?? this.path,
      content: content ?? this.content,
      extra: extra ?? this.extra,
    );
  }
}
