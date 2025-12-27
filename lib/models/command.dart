/// A slash command from OpenCode
/// e.g., /init, /review, or custom commands
///
/// Commands can be:
/// - Built-in: Native OpenCode commands like /init
/// - Custom: User-defined in .opencode/command/*.md files
///
/// See: https://opencode.ai/docs/commands
class SlashCommand {
  final String name;
  final String? description;
  final bool builtin;
  final String? agent; // Specific agent to use (e.g., "build", "plan")
  final String?
  model; // Specific model to use (e.g., "anthropic/claude-sonnet-4")
  final String? template; // Command template (for custom commands)
  final bool subtask; // Run as background subtask

  const SlashCommand({
    required this.name,
    this.description,
    required this.builtin,
    this.agent,
    this.model,
    this.template,
    this.subtask = false,
  });

  factory SlashCommand.fromJson(Map<String, dynamic> json) {
    return SlashCommand(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      builtin: json['builtin'] as bool? ?? false,
      agent: json['agent'] as String?,
      model: json['model'] as String?,
      template: json['template'] as String?,
      subtask: json['subtask'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      'builtin': builtin,
      if (agent != null) 'agent': agent,
      if (model != null) 'model': model,
      if (template != null) 'template': template,
      if (subtask) 'subtask': subtask,
    };
  }

  /// Display name with slash prefix
  String get displayName => '/$name';

  /// Whether this is a custom user-defined command
  bool get isCustom => !builtin;

  /// Whether this command uses a specific agent
  bool get hasAgent => agent != null && agent!.isNotEmpty;

  /// Whether this command uses a specific model
  bool get hasModel => model != null && model!.isNotEmpty;

  /// Get short model name for display (e.g., "claude-sonnet-4" from "anthropic/claude-sonnet-4")
  String? get shortModelName {
    if (model == null || model!.isEmpty) return null;
    final parts = model!.split('/');
    return parts.length > 1 ? parts.last : model;
  }

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
      case 'commit':
        return 'Generate a commit message';
      case 'issues':
        return 'Handle GitHub issues';
      case 'rmslop':
        return 'Remove AI slop from code';
      case 'spellcheck':
        return 'Check spelling in files';
      default:
        return 'Execute command';
    }
  }

  SlashCommand copyWith({
    String? name,
    String? description,
    bool? builtin,
    String? agent,
    String? model,
    String? template,
    bool? subtask,
  }) {
    return SlashCommand(
      name: name ?? this.name,
      description: description ?? this.description,
      builtin: builtin ?? this.builtin,
      agent: agent ?? this.agent,
      model: model ?? this.model,
      template: template ?? this.template,
      subtask: subtask ?? this.subtask,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SlashCommand &&
          runtimeType == other.runtimeType &&
          name == other.name &&
          description == other.description &&
          builtin == other.builtin &&
          agent == other.agent &&
          model == other.model;

  @override
  int get hashCode => Object.hash(name, description, builtin, agent, model);

  @override
  String toString() =>
      'SlashCommand(name: $name, description: $description, builtin: $builtin, '
      'agent: $agent, model: $model, subtask: $subtask)';
}

/// Helper to group commands by type for UI display
class CommandGroups {
  final List<SlashCommand> builtIn;
  final List<SlashCommand> custom;

  const CommandGroups({required this.builtIn, required this.custom});

  factory CommandGroups.fromCommands(List<SlashCommand> commands) {
    final builtIn = commands.where((c) => c.builtin).toList();
    final custom = commands.where((c) => !c.builtin).toList();

    // Sort alphabetically within each group
    builtIn.sort((a, b) => a.name.compareTo(b.name));
    custom.sort((a, b) => a.name.compareTo(b.name));

    return CommandGroups(builtIn: builtIn, custom: custom);
  }

  bool get isEmpty => builtIn.isEmpty && custom.isEmpty;
  bool get hasBuiltIn => builtIn.isNotEmpty;
  bool get hasCustom => custom.isNotEmpty;
  int get totalCount => builtIn.length + custom.length;
}
