class ClaudeCodeSkill {
  final String name;
  final String? description;
  final bool autoInvoke;
  final List<String>? tags;
  final String? source;
  final String? path;
  final String? agent;
  final String? context;

  const ClaudeCodeSkill({
    required this.name,
    this.description,
    required this.autoInvoke,
    this.tags,
    this.source,
    this.path,
    this.agent,
    this.context,
  });

  factory ClaudeCodeSkill.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeSkill(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      autoInvoke: json['autoInvoke'] as bool? ?? false,
      tags: (json['tags'] as List<dynamic>?)?.cast<String>(),
      source: json['source'] as String?,
      path: json['path'] as String?,
      agent: json['agent'] as String?,
      context: json['context'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      'autoInvoke': autoInvoke,
      if (tags != null) 'tags': tags,
      if (source != null) 'source': source,
      if (path != null) 'path': path,
      if (agent != null) 'agent': agent,
      if (context != null) 'context': context,
    };
  }
}
