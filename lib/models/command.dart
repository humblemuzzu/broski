/// Slash command source from OpenCode SDK.
enum CommandSource {
  command,
  mcp,
  skill;

  static CommandSource? fromWireValue(String? value) {
    switch (value) {
      case 'command':
        return CommandSource.command;
      case 'mcp':
        return CommandSource.mcp;
      case 'skill':
        return CommandSource.skill;
      default:
        return null;
    }
  }

  String get wireValue {
    switch (this) {
      case CommandSource.command:
        return 'command';
      case CommandSource.mcp:
        return 'mcp';
      case CommandSource.skill:
        return 'skill';
    }
  }

  String get displayName {
    switch (this) {
      case CommandSource.command:
        return 'Command';
      case CommandSource.mcp:
        return 'MCP';
      case CommandSource.skill:
        return 'Skill';
    }
  }
}

/// A slash command from OpenCode.
class SlashCommand {
  final String name;
  final String? description;
  final CommandSource? source;
  final String? agent;
  final String? model;
  final String? template;
  final bool subtask;
  final List<String> hints;

  const SlashCommand({
    required this.name,
    this.description,
    CommandSource? source,
    bool? builtin,
    this.agent,
    this.model,
    this.template,
    this.subtask = false,
    this.hints = const [],
  }) : source = source ?? (builtin == true ? CommandSource.command : null);

  factory SlashCommand.fromJson(Map<String, dynamic> json) {
    final legacyBuiltin = json['builtin'] as bool?;
    final source =
        CommandSource.fromWireValue(json['source'] as String?) ??
        (legacyBuiltin == true ? CommandSource.command : null);

    return SlashCommand(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      source: source,
      agent: json['agent'] as String?,
      model: json['model'] as String?,
      template: json['template'] as String?,
      subtask: json['subtask'] as bool? ?? false,
      hints: (json['hints'] as List<dynamic>? ?? const [])
          .map((item) => item.toString())
          .where((item) => item.isNotEmpty)
          .toList(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      if (source != null) 'source': source!.wireValue,
      if (agent != null) 'agent': agent,
      if (model != null) 'model': model,
      if (template != null) 'template': template,
      if (subtask) 'subtask': subtask,
      'hints': hints,
    };
  }

  String get displayName => '/$name';

  bool get isBuiltIn => source == null || source == CommandSource.command;

  // Backward-compatible alias
  bool get builtin => isBuiltIn;

  bool get isCustom => !isBuiltIn;

  bool get hasAgent => agent != null && agent!.isNotEmpty;

  bool get hasModel => model != null && model!.isNotEmpty;

  String? get shortModelName {
    if (model == null || model!.isEmpty) return null;
    final parts = model!.split('/');
    return parts.length > 1 ? parts.last : model;
  }

  String get shortDescription {
    if (description != null && description!.isNotEmpty) {
      return description!;
    }
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
    CommandSource? source,
    String? agent,
    String? model,
    String? template,
    bool? subtask,
    List<String>? hints,
  }) {
    return SlashCommand(
      name: name ?? this.name,
      description: description ?? this.description,
      source: source ?? this.source,
      agent: agent ?? this.agent,
      model: model ?? this.model,
      template: template ?? this.template,
      subtask: subtask ?? this.subtask,
      hints: hints ?? this.hints,
    );
  }
}

class CommandGroups {
  final List<SlashCommand> commands;
  final List<SlashCommand> mcpCommands;
  final List<SlashCommand> skillCommands;

  const CommandGroups({
    required this.commands,
    required this.mcpCommands,
    required this.skillCommands,
  });

  factory CommandGroups.fromCommands(List<SlashCommand> commands) {
    final commandItems = commands
        .where((c) => c.source == null || c.source == CommandSource.command)
        .toList();
    final mcpItems = commands
        .where((c) => c.source == CommandSource.mcp)
        .toList();
    final skillItems = commands
        .where((c) => c.source == CommandSource.skill)
        .toList();

    commandItems.sort((a, b) => a.name.compareTo(b.name));
    mcpItems.sort((a, b) => a.name.compareTo(b.name));
    skillItems.sort((a, b) => a.name.compareTo(b.name));

    return CommandGroups(
      commands: commandItems,
      mcpCommands: mcpItems,
      skillCommands: skillItems,
    );
  }

  bool get isEmpty =>
      commands.isEmpty && mcpCommands.isEmpty && skillCommands.isEmpty;

  int get totalCount =>
      commands.length + mcpCommands.length + skillCommands.length;

  // Backward-compatible aliases
  List<SlashCommand> get builtIn => commands;

  List<SlashCommand> get custom => [...mcpCommands, ...skillCommands];

  bool get hasBuiltIn => commands.isNotEmpty;

  bool get hasCustom => mcpCommands.isNotEmpty || skillCommands.isNotEmpty;
}
