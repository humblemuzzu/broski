/// Codex plugin marketplace models.
///
/// Matches SDK `PluginSummary` and `PluginMarketplaceEntry` types.
library;

class CodexPlugin {
  final String id;
  final String name;
  final bool installed;
  final bool enabled;
  final Map<String, dynamic>? source;
  final Map<String, dynamic>? pluginInterface;

  const CodexPlugin({
    required this.id,
    required this.name,
    this.installed = false,
    this.enabled = false,
    this.source,
    this.pluginInterface,
  });

  factory CodexPlugin.fromJson(Map<String, dynamic> json) {
    return CodexPlugin(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      installed: json['installed'] as bool? ?? false,
      enabled: json['enabled'] as bool? ?? false,
      source: json['source'] as Map<String, dynamic>?,
      pluginInterface: json['interface'] as Map<String, dynamic>?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'installed': installed,
        'enabled': enabled,
        if (source != null) 'source': source,
        if (pluginInterface != null) 'interface': pluginInterface,
      };
}

class CodexPluginMarketplace {
  final String name;
  final String path;
  final List<CodexPlugin> plugins;

  const CodexPluginMarketplace({
    required this.name,
    required this.path,
    required this.plugins,
  });

  factory CodexPluginMarketplace.fromJson(Map<String, dynamic> json) {
    return CodexPluginMarketplace(
      name: json['name'] as String? ?? '',
      path: json['path'] as String? ?? '',
      plugins: (json['plugins'] as List<dynamic>?)
              ?.map(
                (e) => CodexPlugin.fromJson(e as Map<String, dynamic>),
              )
              .toList() ??
          const [],
    );
  }
}
