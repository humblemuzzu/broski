import 'package:broski/models/command.dart';

class ClaudeCodeCommand {
  final String name;
  final String? description;
  final String? agent;
  final String? model;
  final bool subtask;
  final String? source;
  final String? path;

  const ClaudeCodeCommand({
    required this.name,
    this.description,
    this.agent,
    this.model,
    this.subtask = false,
    this.source,
    this.path,
  });

  factory ClaudeCodeCommand.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeCommand(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      agent: json['agent'] as String?,
      model: json['model'] as String?,
      subtask: json['subtask'] as bool? ?? false,
      source: json['source'] as String?,
      path: json['path'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      if (agent != null) 'agent': agent,
      if (model != null) 'model': model,
      'subtask': subtask,
      if (source != null) 'source': source,
      if (path != null) 'path': path,
    };
  }

  String get displayName => '/$name';

  /// Convert to SlashCommand for unified autocomplete UI
  SlashCommand toSlashCommand({bool builtin = false}) {
    return SlashCommand(
      name: name,
      description: description,
      builtin: builtin,
      agent: agent,
      model: model,
      subtask: subtask,
    );
  }
}

// -- Config-adjacent types co-located here because ClaudeCodeConfig imports
// this file. (ClaudeCodeSystemPrompt, ClaudeCodeOutputFormat) --

class ClaudeCodeSystemPrompt {
  final String? text;
  final String? preset;
  final String? append;

  const ClaudeCodeSystemPrompt({this.text, this.preset, this.append});

  factory ClaudeCodeSystemPrompt.fromJson(dynamic json) {
    if (json == null) return const ClaudeCodeSystemPrompt();
    if (json is String) return ClaudeCodeSystemPrompt(text: json);
    if (json is Map<String, dynamic>) {
      return ClaudeCodeSystemPrompt(
        preset: json['preset'] as String?,
        append: json['append'] as String?,
      );
    }
    return const ClaudeCodeSystemPrompt();
  }

  dynamic toJson() {
    if (text != null) return text;
    if (preset != null) {
      return {
        'type': 'preset',
        'preset': preset,
        if (append != null) 'append': append,
      };
    }
    return null;
  }

  bool get isEmpty => text == null && preset == null;
  bool get isNotEmpty => !isEmpty;

  String get displayValue {
    if (text != null) return 'Custom';
    if (preset != null) {
      return preset == 'claude_code' ? 'Claude Code' : preset!;
    }
    return 'None';
  }
}

class ClaudeCodeOutputFormat {
  final String type;
  final Map<String, dynamic> schema;

  const ClaudeCodeOutputFormat({
    this.type = 'json_schema',
    required this.schema,
  });

  factory ClaudeCodeOutputFormat.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeOutputFormat(
      type: json['type'] as String? ?? 'json_schema',
      schema: json['schema'] is Map<String, dynamic>
          ? json['schema'] as Map<String, dynamic>
          : const <String, dynamic>{},
    );
  }

  Map<String, dynamic> toJson() {
    return {'type': type, 'schema': schema};
  }
}
