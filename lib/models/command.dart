/// A slash command from OpenCode
/// e.g., /init, /review, or custom commands
class SlashCommand {
  final String name;
  final String? description;
  final bool builtin;

  const SlashCommand({
    required this.name,
    this.description,
    required this.builtin,
  });

  factory SlashCommand.fromJson(Map<String, dynamic> json) {
    return SlashCommand(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      builtin: json['builtin'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      'builtin': builtin,
    };
  }

  /// Display name with slash prefix
  String get displayName => '/$name';

  /// Short description for UI display
  String get shortDescription {
    if (description != null && description!.isNotEmpty) {
      return description!;
    }
    // Default descriptions for built-in commands
    switch (name) {
      case 'init':
        return 'Analyze project and create AGENTS.md';
      case 'review':
        return 'Review changes (commit, branch, or PR)';
      default:
        return 'Execute command';
    }
  }

  SlashCommand copyWith({String? name, String? description, bool? builtin}) {
    return SlashCommand(
      name: name ?? this.name,
      description: description ?? this.description,
      builtin: builtin ?? this.builtin,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SlashCommand &&
          runtimeType == other.runtimeType &&
          name == other.name &&
          description == other.description &&
          builtin == other.builtin;

  @override
  int get hashCode => name.hashCode ^ description.hashCode ^ builtin.hashCode;

  @override
  String toString() =>
      'SlashCommand(name: $name, description: $description, builtin: $builtin)';
}
