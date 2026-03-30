import 'package:broski/models/claude_code/cc_permission.dart';

/// Model for SDK subagent/custom agent definition.
/// Subagents are separate agent instances that can be spawned to handle focused subtasks.
enum ClaudeCodeSubagentModel {
  sonnet,
  opus,
  haiku,
  inherit;

  String get wireValue {
    switch (this) {
      case ClaudeCodeSubagentModel.sonnet:
        return 'sonnet';
      case ClaudeCodeSubagentModel.opus:
        return 'opus';
      case ClaudeCodeSubagentModel.haiku:
        return 'haiku';
      case ClaudeCodeSubagentModel.inherit:
        return 'inherit';
    }
  }

  static ClaudeCodeSubagentModel fromWireValue(String? value) {
    switch (value) {
      case 'sonnet':
        return ClaudeCodeSubagentModel.sonnet;
      case 'opus':
        return ClaudeCodeSubagentModel.opus;
      case 'haiku':
        return ClaudeCodeSubagentModel.haiku;
      default:
        return ClaudeCodeSubagentModel.inherit;
    }
  }

  String get displayName {
    switch (this) {
      case ClaudeCodeSubagentModel.sonnet:
        return 'Sonnet';
      case ClaudeCodeSubagentModel.opus:
        return 'Opus';
      case ClaudeCodeSubagentModel.haiku:
        return 'Haiku';
      case ClaudeCodeSubagentModel.inherit:
        return 'Inherit';
    }
  }
}

class ClaudeCodeSubagent {
  final String name;
  final String description;
  final String prompt;
  final List<String>? tools;
  final ClaudeCodeSubagentModel model;
  final ClaudeCodePermissionMode? permissionMode;
  final List<String>? disallowedTools;
  final List<String>? skills;
  final int? maxTurns;
  final List<dynamic>? mcpServers;
  final bool background;
  final String? isolation;
  final String? initialPrompt;

  const ClaudeCodeSubagent({
    required this.name,
    required this.description,
    required this.prompt,
    this.tools,
    this.model = ClaudeCodeSubagentModel.inherit,
    this.permissionMode,
    this.disallowedTools,
    this.skills,
    this.maxTurns,
    this.mcpServers,
    this.background = false,
    this.isolation,
    this.initialPrompt,
  });

  factory ClaudeCodeSubagent.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeSubagent(
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      prompt: json['prompt'] as String? ?? '',
      tools: (json['tools'] as List<dynamic>?)?.cast<String>(),
      model: ClaudeCodeSubagentModel.fromWireValue(json['model'] as String?),
      permissionMode: json['permissionMode'] != null
          ? ClaudeCodePermissionMode.fromWireValue(
              json['permissionMode'] as String,
            )
          : null,
      disallowedTools: (json['disallowedTools'] as List<dynamic>?)
          ?.cast<String>(),
      skills: (json['skills'] as List<dynamic>?)?.cast<String>(),
      maxTurns: (json['maxTurns'] as num?)?.toInt(),
      mcpServers: json['mcpServers'] as List<dynamic>?,
      background: json['background'] as bool? ?? false,
      isolation: json['isolation'] as String?,
      initialPrompt: json['initialPrompt'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'description': description,
      'prompt': prompt,
      if (tools != null && tools!.isNotEmpty) 'tools': tools,
      if (model != ClaudeCodeSubagentModel.inherit) 'model': model.wireValue,
      if (permissionMode != null) 'permissionMode': permissionMode!.wireValue,
      if (disallowedTools != null && disallowedTools!.isNotEmpty)
        'disallowedTools': disallowedTools,
      if (skills != null && skills!.isNotEmpty) 'skills': skills,
      if (maxTurns != null) 'maxTurns': maxTurns,
      if (mcpServers != null && mcpServers!.isNotEmpty)
        'mcpServers': mcpServers,
      if (background) 'background': true,
      if (isolation != null && isolation!.isNotEmpty) 'isolation': isolation,
      if (initialPrompt != null && initialPrompt!.isNotEmpty)
        'initialPrompt': initialPrompt,
    };
  }

  ClaudeCodeSubagent copyWith({
    String? name,
    String? description,
    String? prompt,
    List<String>? tools,
    ClaudeCodeSubagentModel? model,
    ClaudeCodePermissionMode? permissionMode,
    List<String>? disallowedTools,
    List<String>? skills,
    int? maxTurns,
    List<dynamic>? mcpServers,
    bool? background,
    String? isolation,
    String? initialPrompt,
  }) {
    return ClaudeCodeSubagent(
      name: name ?? this.name,
      description: description ?? this.description,
      prompt: prompt ?? this.prompt,
      tools: tools ?? this.tools,
      model: model ?? this.model,
      permissionMode: permissionMode ?? this.permissionMode,
      disallowedTools: disallowedTools ?? this.disallowedTools,
      skills: skills ?? this.skills,
      maxTurns: maxTurns ?? this.maxTurns,
      mcpServers: mcpServers ?? this.mcpServers,
      background: background ?? this.background,
      isolation: isolation ?? this.isolation,
      initialPrompt: initialPrompt ?? this.initialPrompt,
    );
  }
}
