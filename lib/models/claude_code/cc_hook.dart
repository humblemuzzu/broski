class ClaudeCodeHook {
  final String id;
  final String event;
  final String? matcher;
  final bool enabled;
  final String? description;
  final List<dynamic>? hooks;
  final String? source;
  final String? path;

  const ClaudeCodeHook({
    required this.id,
    required this.event,
    this.matcher,
    required this.enabled,
    this.description,
    this.hooks,
    this.source,
    this.path,
  });

  factory ClaudeCodeHook.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeHook(
      id: json['id'] as String? ?? '',
      event: json['event'] as String? ?? '',
      matcher: json['matcher'] as String?,
      enabled: json['enabled'] as bool? ?? true,
      description: json['description'] as String?,
      hooks: json['hooks'] as List<dynamic>?,
      source: json['source'] as String?,
      path: json['path'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'event': event,
      if (matcher != null) 'matcher': matcher,
      'enabled': enabled,
      if (description != null) 'description': description,
      if (hooks != null) 'hooks': hooks,
      if (source != null) 'source': source,
      if (path != null) 'path': path,
    };
  }
}
