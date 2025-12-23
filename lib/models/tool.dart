// Feature 17: Tool List
// Models for AI tools (bash, read, write, edit, glob, grep, etc.)

/// Information about an AI tool
class ToolInfo {
  final String id;
  final String name;
  final String? description;
  final bool enabled;

  const ToolInfo({
    required this.id,
    required this.name,
    this.description,
    required this.enabled,
  });

  factory ToolInfo.fromJson(Map<String, dynamic> json) {
    return ToolInfo(
      id: json['id'] as String? ?? json['name'] as String? ?? '',
      name: json['name'] as String? ?? json['id'] as String? ?? '',
      description: json['description'] as String?,
      enabled: json['enabled'] as bool? ?? true,
    );
  }

  /// Get a human-friendly display name
  String get displayName {
    // Capitalize first letter
    if (name.isEmpty) return id;
    return name[0].toUpperCase() + name.substring(1);
  }

  /// Get icon for this tool
  String get iconName {
    switch (id.toLowerCase()) {
      case 'bash':
        return 'terminal';
      case 'read':
        return 'file_open';
      case 'write':
        return 'edit_document';
      case 'edit':
        return 'edit';
      case 'glob':
        return 'folder_search';
      case 'grep':
        return 'search';
      case 'webfetch':
        return 'language';
      case 'task':
        return 'task';
      case 'todowrite':
      case 'todoread':
        return 'checklist';
      default:
        return 'build';
    }
  }

  /// Get category for grouping tools
  String get category {
    switch (id.toLowerCase()) {
      case 'bash':
        return 'Shell';
      case 'read':
      case 'write':
      case 'edit':
      case 'glob':
      case 'grep':
        return 'File Operations';
      case 'webfetch':
        return 'Web';
      case 'task':
        return 'Agents';
      case 'todowrite':
      case 'todoread':
        return 'Planning';
      default:
        return 'Other';
    }
  }
}
