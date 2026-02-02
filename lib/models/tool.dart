// Feature 17: Tool List
// Models for AI tools (bash, read, write, edit, glob, grep, etc.)

/// Information about an AI tool
class ToolInfo {
  final String id;
  final String? description;
  final Map<String, dynamic> parameters;

  const ToolInfo({
    required this.id,
    this.description,
    this.parameters = const {},
  });

  factory ToolInfo.fromJson(Map<String, dynamic> json) {
    return ToolInfo(
      id: json['id'] as String? ?? '',
      description: json['description'] as String?,
      parameters: json['parameters'] is Map<String, dynamic>
          ? json['parameters'] as Map<String, dynamic>
          : const {},
    );
  }

  /// Get a human-friendly display name
  String get displayName {
    // Capitalize first letter
    if (id.isEmpty) return '';
    return id[0].toUpperCase() + id.substring(1);
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
