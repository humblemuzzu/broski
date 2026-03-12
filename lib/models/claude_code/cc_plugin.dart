// ============================================================================
// CLAUDE CODE PLUGINS
// ============================================================================

/// Plugin status enum
enum ClaudeCodePluginStatus {
  enabled,
  disabled,
  error;

  String get wireValue {
    switch (this) {
      case ClaudeCodePluginStatus.enabled:
        return 'enabled';
      case ClaudeCodePluginStatus.disabled:
        return 'disabled';
      case ClaudeCodePluginStatus.error:
        return 'error';
    }
  }

  static ClaudeCodePluginStatus fromWireValue(String? value) {
    switch (value) {
      case 'enabled':
        return ClaudeCodePluginStatus.enabled;
      case 'disabled':
        return ClaudeCodePluginStatus.disabled;
      case 'error':
        return ClaudeCodePluginStatus.error;
      default:
        return ClaudeCodePluginStatus.enabled;
    }
  }

  String get displayName {
    switch (this) {
      case ClaudeCodePluginStatus.enabled:
        return 'Enabled';
      case ClaudeCodePluginStatus.disabled:
        return 'Disabled';
      case ClaudeCodePluginStatus.error:
        return 'Error';
    }
  }
}

/// Plugin manifest (from plugin.json)
class ClaudeCodePluginManifest {
  final String name;
  final String? version;
  final String? description;
  final String? authorName;
  final String? authorEmail;
  final String? authorUrl;
  final String? homepage;
  final String? repository;
  final String? license;
  final List<String>? keywords;

  const ClaudeCodePluginManifest({
    required this.name,
    this.version,
    this.description,
    this.authorName,
    this.authorEmail,
    this.authorUrl,
    this.homepage,
    this.repository,
    this.license,
    this.keywords,
  });

  factory ClaudeCodePluginManifest.fromJson(Map<String, dynamic> json) {
    final author = json['author'] as Map<String, dynamic>?;
    return ClaudeCodePluginManifest(
      name: json['name'] as String? ?? '',
      version: json['version'] as String?,
      description: json['description'] as String?,
      authorName: author?['name'] as String?,
      authorEmail: author?['email'] as String?,
      authorUrl: author?['url'] as String?,
      homepage: json['homepage'] as String?,
      repository: json['repository'] as String?,
      license: json['license'] as String?,
      keywords: (json['keywords'] as List<dynamic>?)?.cast<String>(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (version != null) 'version': version,
      if (description != null) 'description': description,
      if (authorName != null || authorEmail != null || authorUrl != null)
        'author': {
          if (authorName != null) 'name': authorName,
          if (authorEmail != null) 'email': authorEmail,
          if (authorUrl != null) 'url': authorUrl,
        },
      if (homepage != null) 'homepage': homepage,
      if (repository != null) 'repository': repository,
      if (license != null) 'license': license,
      if (keywords != null && keywords!.isNotEmpty) 'keywords': keywords,
    };
  }
}

/// Full plugin definition
class ClaudeCodePlugin {
  final String name;
  final String path;
  final ClaudeCodePluginStatus status;
  final ClaudeCodePluginManifest? manifest;
  final List<String>? commands;
  final List<String>? agents;
  final List<String>? skills;
  final bool hasHooks;
  final bool hasMcpServers;
  final int? loadedAt;
  final String? error;

  const ClaudeCodePlugin({
    required this.name,
    required this.path,
    required this.status,
    this.manifest,
    this.commands,
    this.agents,
    this.skills,
    this.hasHooks = false,
    this.hasMcpServers = false,
    this.loadedAt,
    this.error,
  });

  factory ClaudeCodePlugin.fromJson(Map<String, dynamic> json) {
    return ClaudeCodePlugin(
      name: json['name'] as String? ?? '',
      path: json['path'] as String? ?? '',
      status: ClaudeCodePluginStatus.fromWireValue(json['status'] as String?),
      manifest: json['manifest'] != null
          ? ClaudeCodePluginManifest.fromJson(
              json['manifest'] as Map<String, dynamic>,
            )
          : null,
      commands: (json['commands'] as List<dynamic>?)?.cast<String>(),
      agents: (json['agents'] as List<dynamic>?)?.cast<String>(),
      skills: (json['skills'] as List<dynamic>?)?.cast<String>(),
      hasHooks: json['hasHooks'] as bool? ?? false,
      hasMcpServers: json['hasMcpServers'] as bool? ?? false,
      loadedAt: json['loadedAt'] as int?,
      error: json['error'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'path': path,
      'status': status.wireValue,
      if (manifest != null) 'manifest': manifest!.toJson(),
      if (commands != null && commands!.isNotEmpty) 'commands': commands,
      if (agents != null && agents!.isNotEmpty) 'agents': agents,
      if (skills != null && skills!.isNotEmpty) 'skills': skills,
      if (hasHooks) 'hasHooks': hasHooks,
      if (hasMcpServers) 'hasMcpServers': hasMcpServers,
      if (loadedAt != null) 'loadedAt': loadedAt,
      if (error != null) 'error': error,
    };
  }

  /// Display name (from manifest or plugin name)
  String get displayName => manifest?.name ?? name;

  /// Description (from manifest)
  String get description => manifest?.description ?? 'Plugin at $path';

  /// Version string (from manifest)
  String get version => manifest?.version ?? 'unknown';

  /// Total component count
  int get componentCount =>
      (commands?.length ?? 0) +
      (agents?.length ?? 0) +
      (skills?.length ?? 0) +
      (hasHooks ? 1 : 0) +
      (hasMcpServers ? 1 : 0);

  /// Create a copy with updated status
  ClaudeCodePlugin copyWith({
    String? name,
    String? path,
    ClaudeCodePluginStatus? status,
    ClaudeCodePluginManifest? manifest,
    List<String>? commands,
    List<String>? agents,
    List<String>? skills,
    bool? hasHooks,
    bool? hasMcpServers,
    int? loadedAt,
    String? error,
  }) {
    return ClaudeCodePlugin(
      name: name ?? this.name,
      path: path ?? this.path,
      status: status ?? this.status,
      manifest: manifest ?? this.manifest,
      commands: commands ?? this.commands,
      agents: agents ?? this.agents,
      skills: skills ?? this.skills,
      hasHooks: hasHooks ?? this.hasHooks,
      hasMcpServers: hasMcpServers ?? this.hasMcpServers,
      loadedAt: loadedAt ?? this.loadedAt,
      error: error ?? this.error,
    );
  }
}

/// Plugin configuration (enabled/disabled state + custom paths)
class ClaudeCodePluginConfig {
  final List<String> enabled;
  final List<String> disabled;
  final List<String> customPaths;

  const ClaudeCodePluginConfig({
    this.enabled = const [],
    this.disabled = const [],
    this.customPaths = const [],
  });

  factory ClaudeCodePluginConfig.fromJson(Map<String, dynamic> json) {
    return ClaudeCodePluginConfig(
      enabled: (json['enabled'] as List<dynamic>?)?.cast<String>() ?? const [],
      disabled:
          (json['disabled'] as List<dynamic>?)?.cast<String>() ?? const [],
      customPaths:
          (json['customPaths'] as List<dynamic>?)?.cast<String>() ?? const [],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'enabled': enabled,
      'disabled': disabled,
      'customPaths': customPaths,
    };
  }
}
