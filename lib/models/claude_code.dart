import 'command.dart';

enum ClaudeCodePermissionMode {
  defaultMode,
  acceptEdits,
  plan,
  bypassPermissions;

  String get wireValue {
    switch (this) {
      case ClaudeCodePermissionMode.defaultMode:
        return 'default';
      case ClaudeCodePermissionMode.acceptEdits:
        return 'acceptEdits';
      case ClaudeCodePermissionMode.plan:
        return 'plan';
      case ClaudeCodePermissionMode.bypassPermissions:
        return 'bypassPermissions';
    }
  }

  static ClaudeCodePermissionMode fromWireValue(String value) {
    switch (value) {
      case 'acceptEdits':
        return ClaudeCodePermissionMode.acceptEdits;
      case 'plan':
        return ClaudeCodePermissionMode.plan;
      case 'bypassPermissions':
        return ClaudeCodePermissionMode.bypassPermissions;
      default:
        return ClaudeCodePermissionMode.defaultMode;
    }
  }

  String get displayName {
    switch (this) {
      case ClaudeCodePermissionMode.defaultMode:
        return 'Default';
      case ClaudeCodePermissionMode.acceptEdits:
        return 'Accept Edits';
      case ClaudeCodePermissionMode.plan:
        return 'Plan Only';
      case ClaudeCodePermissionMode.bypassPermissions:
        return 'Bypass Permissions';
    }
  }
}

class ClaudeCodeSession {
  final String id;
  final String? title;
  final String cwd;
  final String? model;
  final int createdAt;
  final int updatedAt;
  final int? messageCount;

  const ClaudeCodeSession({
    required this.id,
    this.title,
    required this.cwd,
    this.model,
    required this.createdAt,
    required this.updatedAt,
    this.messageCount,
  });

  factory ClaudeCodeSession.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeSession(
      id: json['id'] as String? ?? '',
      title: json['title'] as String?,
      cwd: json['cwd'] as String? ?? '',
      model: json['model'] as String?,
      createdAt: json['createdAt'] as int? ?? 0,
      updatedAt: json['updatedAt'] as int? ?? 0,
      messageCount: json['messageCount'] as int?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      if (title != null) 'title': title,
      'cwd': cwd,
      if (model != null) 'model': model,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
      if (messageCount != null) 'messageCount': messageCount,
    };
  }

  String get displayTitle => title ?? 'Session ${id.substring(0, 8)}';

  DateTime get createdAtDateTime =>
      DateTime.fromMillisecondsSinceEpoch(createdAt);
  DateTime get updatedAtDateTime =>
      DateTime.fromMillisecondsSinceEpoch(updatedAt);
}

class ClaudeCodeSkill {
  final String name;
  final String? description;
  final bool autoInvoke;
  final List<String>? tags;

  const ClaudeCodeSkill({
    required this.name,
    this.description,
    required this.autoInvoke,
    this.tags,
  });

  factory ClaudeCodeSkill.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeSkill(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      autoInvoke: json['autoInvoke'] as bool? ?? false,
      tags: (json['tags'] as List<dynamic>?)?.cast<String>(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      'autoInvoke': autoInvoke,
      if (tags != null) 'tags': tags,
    };
  }
}

class ClaudeCodeHook {
  final String id;
  final String event;
  final String? matcher;
  final bool enabled;
  final String? description;

  const ClaudeCodeHook({
    required this.id,
    required this.event,
    this.matcher,
    required this.enabled,
    this.description,
  });

  factory ClaudeCodeHook.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeHook(
      id: json['id'] as String? ?? '',
      event: json['event'] as String? ?? '',
      matcher: json['matcher'] as String?,
      enabled: json['enabled'] as bool? ?? true,
      description: json['description'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'event': event,
      if (matcher != null) 'matcher': matcher,
      'enabled': enabled,
      if (description != null) 'description': description,
    };
  }
}

class ClaudeCodeCommand {
  final String name;
  final String? description;
  final String? agent;
  final String? model;
  final bool subtask;

  const ClaudeCodeCommand({
    required this.name,
    this.description,
    this.agent,
    this.model,
    this.subtask = false,
  });

  factory ClaudeCodeCommand.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeCommand(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      agent: json['agent'] as String?,
      model: json['model'] as String?,
      subtask: json['subtask'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      if (agent != null) 'agent': agent,
      if (model != null) 'model': model,
      'subtask': subtask,
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
    if (preset != null)
      return preset == 'claude_code' ? 'Claude Code' : preset!;
    return 'None';
  }
}

class ClaudeCodeConfig {
  final ClaudeCodePermissionMode permissionMode;
  final List<String> allowedTools;
  final List<String> disallowedTools;
  final String? model;
  final ClaudeCodeSystemPrompt? systemPrompt;

  const ClaudeCodeConfig({
    required this.permissionMode,
    required this.allowedTools,
    required this.disallowedTools,
    this.model,
    this.systemPrompt,
  });

  factory ClaudeCodeConfig.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeConfig(
      permissionMode: ClaudeCodePermissionMode.fromWireValue(
        json['permissionMode'] as String? ?? 'default',
      ),
      allowedTools:
          (json['allowedTools'] as List<dynamic>?)?.cast<String>() ?? const [],
      disallowedTools:
          (json['disallowedTools'] as List<dynamic>?)?.cast<String>() ??
          const [],
      model: json['model'] as String?,
      systemPrompt: json['systemPrompt'] != null
          ? ClaudeCodeSystemPrompt.fromJson(json['systemPrompt'])
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'permissionMode': permissionMode.wireValue,
      'allowedTools': allowedTools,
      'disallowedTools': disallowedTools,
      if (model != null) 'model': model,
      if (systemPrompt != null) 'systemPrompt': systemPrompt!.toJson(),
    };
  }

  ClaudeCodeConfig copyWith({
    ClaudeCodePermissionMode? permissionMode,
    List<String>? allowedTools,
    List<String>? disallowedTools,
    String? model,
    ClaudeCodeSystemPrompt? systemPrompt,
  }) {
    return ClaudeCodeConfig(
      permissionMode: permissionMode ?? this.permissionMode,
      allowedTools: allowedTools ?? this.allowedTools,
      disallowedTools: disallowedTools ?? this.disallowedTools,
      model: model ?? this.model,
      systemPrompt: systemPrompt ?? this.systemPrompt,
    );
  }
}

sealed class ClaudeCodeStreamMessage {
  const ClaudeCodeStreamMessage();

  factory ClaudeCodeStreamMessage.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String?;
    switch (type) {
      case 'session-created':
        return CCSessionCreated.fromJson(json);
      case 'session-init':
        return CCSessionInit.fromJson(json);
      case 'permission-request':
        return CCPermissionRequest.fromJson(json);
      case 'assistant-message':
        return CCAssistantMessage.fromJson(json);
      case 'assistant-message-delta':
        return CCAssistantMessageDelta.fromJson(json);
      case 'thinking-delta':
        return CCThinkingDelta.fromJson(json);
      case 'tool-call':
        return CCToolCall.fromJson(json);
      case 'tool-result':
        return CCToolResult.fromJson(json);
      case 'token-usage':
        return CCTokenUsage.fromJson(json);
      case 'error':
        return CCError.fromJson(json);
      default:
        return CCUnknown(type ?? 'unknown', json);
    }
  }
}

class CCSessionCreated extends ClaudeCodeStreamMessage {
  final String sessionId;
  final String agent;
  final String? model;

  const CCSessionCreated({
    required this.sessionId,
    required this.agent,
    this.model,
  });

  factory CCSessionCreated.fromJson(Map<String, dynamic> json) {
    return CCSessionCreated(
      sessionId: json['sessionId'] as String? ?? '',
      agent: json['agent'] as String? ?? 'claude-code',
      model: json['model'] as String?,
    );
  }
}

class CCSessionInit extends ClaudeCodeStreamMessage {
  final String sessionId;
  final String model;
  final ClaudeCodePermissionMode permissionMode;
  final List<String> tools;
  final List<String> slashCommands;
  final List<String> skills;
  final List<Map<String, dynamic>> mcpServers;
  final List<Map<String, dynamic>> plugins;
  final String? apiKeySource;
  final String? claudeCodeVersion;

  const CCSessionInit({
    required this.sessionId,
    required this.model,
    required this.permissionMode,
    required this.tools,
    required this.slashCommands,
    required this.skills,
    required this.mcpServers,
    required this.plugins,
    this.apiKeySource,
    this.claudeCodeVersion,
  });

  factory CCSessionInit.fromJson(Map<String, dynamic> json) {
    return CCSessionInit(
      sessionId: json['sessionId'] as String? ?? '',
      model: json['model'] as String? ?? '',
      permissionMode: ClaudeCodePermissionMode.fromWireValue(
        json['permissionMode'] as String? ?? 'default',
      ),
      tools:
          (json['tools'] as List<dynamic>?)?.map((e) => '$e').toList() ??
          const [],
      slashCommands:
          (json['slashCommands'] as List<dynamic>?)
              ?.map((e) => '$e')
              .toList() ??
          const [],
      skills:
          (json['skills'] as List<dynamic>?)?.map((e) => '$e').toList() ??
          const [],
      mcpServers:
          (json['mcpServers'] as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .toList() ??
          const [],
      plugins:
          (json['plugins'] as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .toList() ??
          const [],
      apiKeySource: json['apiKeySource'] as String?,
      claudeCodeVersion: json['claudeCodeVersion'] as String?,
    );
  }
}

class CCPermissionRequest extends ClaudeCodeStreamMessage {
  final String sessionId;
  final String toolUseId;
  final String tool;
  final Map<String, dynamic> input;
  final String? decisionReason;
  final String? blockedPath;
  final bool hasSuggestions;

  const CCPermissionRequest({
    required this.sessionId,
    required this.toolUseId,
    required this.tool,
    required this.input,
    this.decisionReason,
    this.blockedPath,
    required this.hasSuggestions,
  });

  factory CCPermissionRequest.fromJson(Map<String, dynamic> json) {
    return CCPermissionRequest(
      sessionId: json['sessionId'] as String? ?? '',
      toolUseId: json['toolUseId'] as String? ?? '',
      tool: json['tool'] as String? ?? '',
      input: json['input'] is Map<String, dynamic>
          ? json['input'] as Map<String, dynamic>
          : const <String, dynamic>{},
      decisionReason: json['decisionReason'] as String?,
      blockedPath: json['blockedPath'] as String?,
      hasSuggestions: json['hasSuggestions'] as bool? ?? false,
    );
  }
}

class CCAssistantMessage extends ClaudeCodeStreamMessage {
  final String content;

  const CCAssistantMessage({required this.content});

  factory CCAssistantMessage.fromJson(Map<String, dynamic> json) {
    return CCAssistantMessage(content: json['content'] as String? ?? '');
  }
}

class CCAssistantMessageDelta extends ClaudeCodeStreamMessage {
  final String content;

  const CCAssistantMessageDelta({required this.content});

  factory CCAssistantMessageDelta.fromJson(Map<String, dynamic> json) {
    return CCAssistantMessageDelta(content: json['content'] as String? ?? '');
  }
}

class CCThinkingDelta extends ClaudeCodeStreamMessage {
  final String content;
  final String? partId;

  const CCThinkingDelta({required this.content, this.partId});

  factory CCThinkingDelta.fromJson(Map<String, dynamic> json) {
    return CCThinkingDelta(
      content: json['content'] as String? ?? '',
      partId: json['partId'] as String?,
    );
  }
}

class CCToolCall extends ClaudeCodeStreamMessage {
  final String tool;
  final dynamic input;
  final String? toolUseId;
  final String status;

  const CCToolCall({
    required this.tool,
    this.input,
    this.toolUseId,
    required this.status,
  });

  factory CCToolCall.fromJson(Map<String, dynamic> json) {
    return CCToolCall(
      tool: json['tool'] as String? ?? '',
      input: json['input'],
      toolUseId: json['toolUseId'] as String?,
      status: json['status'] as String? ?? 'running',
    );
  }
}

class CCToolResult extends ClaudeCodeStreamMessage {
  final String? toolUseId;
  final dynamic result;
  final dynamic toolUseResult;

  const CCToolResult({this.toolUseId, this.result, this.toolUseResult});

  factory CCToolResult.fromJson(Map<String, dynamic> json) {
    return CCToolResult(
      toolUseId: json['toolUseId'] as String?,
      result: json['result'],
      toolUseResult: json['toolUseResult'],
    );
  }
}

class CCTokenUsage extends ClaudeCodeStreamMessage {
  final int? inputTokens;
  final int? outputTokens;
  final int? cacheReadTokens;

  const CCTokenUsage({
    this.inputTokens,
    this.outputTokens,
    this.cacheReadTokens,
  });

  factory CCTokenUsage.fromJson(Map<String, dynamic> json) {
    final usage = json['usage'] as Map<String, dynamic>? ?? json;
    return CCTokenUsage(
      inputTokens: usage['inputTokens'] as int?,
      outputTokens: usage['outputTokens'] as int?,
      cacheReadTokens: usage['cacheReadTokens'] as int?,
    );
  }
}

class CCError extends ClaudeCodeStreamMessage {
  final String message;
  final String? code;

  const CCError({required this.message, this.code});

  factory CCError.fromJson(Map<String, dynamic> json) {
    return CCError(
      message: json['message'] as String? ?? 'Unknown error',
      code: json['code'] as String?,
    );
  }
}

class CCUnknown extends ClaudeCodeStreamMessage {
  final String type;
  final Map<String, dynamic> data;

  const CCUnknown(this.type, this.data);
}
