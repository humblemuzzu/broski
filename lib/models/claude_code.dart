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

  const ClaudeCodeSubagent({
    required this.name,
    required this.description,
    required this.prompt,
    this.tools,
    this.model = ClaudeCodeSubagentModel.inherit,
  });

  factory ClaudeCodeSubagent.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeSubagent(
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      prompt: json['prompt'] as String? ?? '',
      tools: (json['tools'] as List<dynamic>?)?.cast<String>(),
      model: ClaudeCodeSubagentModel.fromWireValue(json['model'] as String?),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'description': description,
      'prompt': prompt,
      if (tools != null && tools!.isNotEmpty) 'tools': tools,
      if (model != ClaudeCodeSubagentModel.inherit) 'model': model.wireValue,
    };
  }

  ClaudeCodeSubagent copyWith({
    String? name,
    String? description,
    String? prompt,
    List<String>? tools,
    ClaudeCodeSubagentModel? model,
  }) {
    return ClaudeCodeSubagent(
      name: name ?? this.name,
      description: description ?? this.description,
      prompt: prompt ?? this.prompt,
      tools: tools ?? this.tools,
      model: model ?? this.model,
    );
  }
}

class ClaudeCodeConfig {
  final ClaudeCodePermissionMode permissionMode;
  final List<String> allowedTools;
  final List<String> disallowedTools;
  final String? model;
  final ClaudeCodeSystemPrompt? systemPrompt;
  final List<ClaudeCodeSubagent> subagents;
  final String? activeSubagent;

  const ClaudeCodeConfig({
    required this.permissionMode,
    required this.allowedTools,
    required this.disallowedTools,
    this.model,
    this.systemPrompt,
    this.subagents = const [],
    this.activeSubagent,
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
      subagents:
          (json['subagents'] as List<dynamic>?)
              ?.map(
                (e) => ClaudeCodeSubagent.fromJson(e as Map<String, dynamic>),
              )
              .toList() ??
          const [],
      activeSubagent: json['activeSubagent'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'permissionMode': permissionMode.wireValue,
      'allowedTools': allowedTools,
      'disallowedTools': disallowedTools,
      if (model != null) 'model': model,
      if (systemPrompt != null) 'systemPrompt': systemPrompt!.toJson(),
      if (subagents.isNotEmpty)
        'subagents': subagents.map((e) => e.toJson()).toList(),
      if (activeSubagent != null) 'activeSubagent': activeSubagent,
    };
  }

  ClaudeCodeConfig copyWith({
    ClaudeCodePermissionMode? permissionMode,
    List<String>? allowedTools,
    List<String>? disallowedTools,
    String? model,
    ClaudeCodeSystemPrompt? systemPrompt,
    List<ClaudeCodeSubagent>? subagents,
    String? activeSubagent,
  }) {
    return ClaudeCodeConfig(
      permissionMode: permissionMode ?? this.permissionMode,
      allowedTools: allowedTools ?? this.allowedTools,
      disallowedTools: disallowedTools ?? this.disallowedTools,
      model: model ?? this.model,
      systemPrompt: systemPrompt ?? this.systemPrompt,
      subagents: subagents ?? this.subagents,
      activeSubagent: activeSubagent ?? this.activeSubagent,
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
      case 'checkpoint-created':
        return CCCheckpointCreated.fromJson(json);
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
      case 'subagent-invocation':
        return CCSubagentInvocation.fromJson(json);
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

/// Checkpoint created event for file checkpointing/undo support.
/// Each user message turn creates a checkpoint that can be used to rewind file changes.
class CCCheckpointCreated extends ClaudeCodeStreamMessage {
  final String sessionId;
  final String checkpointUuid;
  final int timestamp;

  const CCCheckpointCreated({
    required this.sessionId,
    required this.checkpointUuid,
    required this.timestamp,
  });

  factory CCCheckpointCreated.fromJson(Map<String, dynamic> json) {
    return CCCheckpointCreated(
      sessionId: json['sessionId'] as String? ?? '',
      checkpointUuid: json['checkpointUuid'] as String? ?? '',
      timestamp: json['timestamp'] as int? ?? 0,
    );
  }

  DateTime get timestampDateTime =>
      DateTime.fromMillisecondsSinceEpoch(timestamp);
}

class CCAssistantMessage extends ClaudeCodeStreamMessage {
  final String content;
  final String? messageId;

  const CCAssistantMessage({required this.content, this.messageId});

  factory CCAssistantMessage.fromJson(Map<String, dynamic> json) {
    return CCAssistantMessage(
      content: json['content'] as String? ?? '',
      messageId: json['messageId'] as String?,
    );
  }
}

class CCAssistantMessageDelta extends ClaudeCodeStreamMessage {
  final String content;
  final String? messageId;

  const CCAssistantMessageDelta({required this.content, this.messageId});

  factory CCAssistantMessageDelta.fromJson(Map<String, dynamic> json) {
    return CCAssistantMessageDelta(
      content: json['content'] as String? ?? '',
      messageId: json['messageId'] as String?,
    );
  }
}

class CCThinkingDelta extends ClaudeCodeStreamMessage {
  final String content;
  final String? partId;
  final String? messageId;

  const CCThinkingDelta({required this.content, this.partId, this.messageId});

  factory CCThinkingDelta.fromJson(Map<String, dynamic> json) {
    return CCThinkingDelta(
      content: json['content'] as String? ?? '',
      partId: json['partId'] as String?,
      messageId: json['messageId'] as String?,
    );
  }
}

class CCToolCall extends ClaudeCodeStreamMessage {
  final String tool;
  final dynamic input;
  final String? toolUseId;
  final String status;
  final String? messageId;

  const CCToolCall({
    required this.tool,
    this.input,
    this.toolUseId,
    required this.status,
    this.messageId,
  });

  factory CCToolCall.fromJson(Map<String, dynamic> json) {
    return CCToolCall(
      tool: json['tool'] as String? ?? '',
      input: json['input'],
      toolUseId: json['toolUseId'] as String?,
      status: json['status'] as String? ?? 'running',
      messageId: json['messageId'] as String?,
    );
  }
}

class CCToolResult extends ClaudeCodeStreamMessage {
  final String? toolUseId;
  final dynamic result;
  final dynamic toolUseResult;
  final String? messageId;

  const CCToolResult({
    this.toolUseId,
    this.result,
    this.toolUseResult,
    this.messageId,
  });

  factory CCToolResult.fromJson(Map<String, dynamic> json) {
    return CCToolResult(
      toolUseId: json['toolUseId'] as String?,
      result: json['result'],
      toolUseResult: json['toolUseResult'],
      messageId: json['messageId'] as String?,
    );
  }
}

/// Subagent invocation event - emitted when Claude invokes a subagent via Task tool.
/// This provides UI feedback about which subagent is being used.
class CCSubagentInvocation extends ClaudeCodeStreamMessage {
  /// The name of the subagent being invoked (from subagent_type in Task input)
  final String subagentName;

  /// Tool use ID for correlation with tool-call events
  final String? toolUseId;

  /// The prompt/task given to the subagent
  final String? prompt;

  /// Description of what the subagent is doing
  final String? description;

  /// Identifier tying this invocation to an assistant turn/message.
  final String? messageId;

  const CCSubagentInvocation({
    required this.subagentName,
    this.toolUseId,
    this.prompt,
    this.description,
    this.messageId,
  });

  factory CCSubagentInvocation.fromJson(Map<String, dynamic> json) {
    return CCSubagentInvocation(
      subagentName: json['subagentName'] as String? ?? 'unknown',
      toolUseId: json['toolUseId'] as String?,
      prompt: json['prompt'] as String?,
      description: json['description'] as String?,
      messageId: json['messageId'] as String?,
    );
  }
}

class CCTokenUsage extends ClaudeCodeStreamMessage {
  final int? inputTokens;
  final int? outputTokens;
  final int? cacheReadTokens;
  final int? cacheCreationTokens;
  final double? totalCostUsd;
  final String? messageId;

  const CCTokenUsage({
    this.inputTokens,
    this.outputTokens,
    this.cacheReadTokens,
    this.cacheCreationTokens,
    this.totalCostUsd,
    this.messageId,
  });

  factory CCTokenUsage.fromJson(Map<String, dynamic> json) {
    final usage = json['usage'] as Map<String, dynamic>? ?? json;
    return CCTokenUsage(
      inputTokens: usage['inputTokens'] as int?,
      outputTokens: usage['outputTokens'] as int?,
      cacheReadTokens: usage['cacheReadTokens'] as int?,
      cacheCreationTokens: usage['cacheCreationTokens'] as int?,
      totalCostUsd: (json['totalCostUsd'] as num?)?.toDouble(),
      messageId: json['messageId'] as String?,
    );
  }

  /// Total tokens used (input + output + cache)
  int get totalTokens =>
      (inputTokens ?? 0) + (outputTokens ?? 0) + (cacheReadTokens ?? 0);
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

// =============================================================================
// Custom Tool Types
// =============================================================================

/// Parameter type for custom tool parameters
enum CustomToolParameterType {
  string,
  number,
  boolean,
  array,
  object;

  String get wireValue => name;

  static CustomToolParameterType fromWireValue(String? value) {
    switch (value) {
      case 'number':
        return CustomToolParameterType.number;
      case 'boolean':
        return CustomToolParameterType.boolean;
      case 'array':
        return CustomToolParameterType.array;
      case 'object':
        return CustomToolParameterType.object;
      default:
        return CustomToolParameterType.string;
    }
  }

  String get displayName {
    switch (this) {
      case CustomToolParameterType.string:
        return 'Text';
      case CustomToolParameterType.number:
        return 'Number';
      case CustomToolParameterType.boolean:
        return 'Boolean';
      case CustomToolParameterType.array:
        return 'Array';
      case CustomToolParameterType.object:
        return 'Object';
    }
  }
}

/// Handler type for custom tools
enum CustomToolHandlerType {
  http,
  script;

  String get wireValue => name;

  static CustomToolHandlerType fromWireValue(String? value) {
    switch (value) {
      case 'script':
        return CustomToolHandlerType.script;
      default:
        return CustomToolHandlerType.http;
    }
  }

  String get displayName {
    switch (this) {
      case CustomToolHandlerType.http:
        return 'HTTP Request';
      case CustomToolHandlerType.script:
        return 'Script/Command';
    }
  }

  String get description {
    switch (this) {
      case CustomToolHandlerType.http:
        return 'Make HTTP requests to external APIs';
      case CustomToolHandlerType.script:
        return 'Execute local scripts or commands';
    }
  }
}

/// HTTP method for HTTP handler
enum HttpMethod {
  get,
  post,
  put,
  delete,
  patch;

  String get wireValue => name.toUpperCase();

  static HttpMethod fromWireValue(String? value) {
    switch (value?.toUpperCase()) {
      case 'POST':
        return HttpMethod.post;
      case 'PUT':
        return HttpMethod.put;
      case 'DELETE':
        return HttpMethod.delete;
      case 'PATCH':
        return HttpMethod.patch;
      default:
        return HttpMethod.get;
    }
  }

  String get displayName => wireValue;
}

/// Custom tool parameter definition
class CustomToolParameter {
  final String name;
  final CustomToolParameterType type;
  final String? description;
  final bool required;
  final dynamic defaultValue;
  final List<String>? enumValues;

  const CustomToolParameter({
    required this.name,
    required this.type,
    this.description,
    this.required = false,
    this.defaultValue,
    this.enumValues,
  });

  factory CustomToolParameter.fromJson(Map<String, dynamic> json) {
    return CustomToolParameter(
      name: json['name'] as String? ?? '',
      type: CustomToolParameterType.fromWireValue(json['type'] as String?),
      description: json['description'] as String?,
      required: json['required'] as bool? ?? false,
      defaultValue: json['default'],
      enumValues: (json['enum'] as List<dynamic>?)?.cast<String>(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'type': type.wireValue,
      if (description != null && description!.isNotEmpty)
        'description': description,
      if (required) 'required': required,
      if (defaultValue != null) 'default': defaultValue,
      if (enumValues != null && enumValues!.isNotEmpty) 'enum': enumValues,
    };
  }

  CustomToolParameter copyWith({
    String? name,
    CustomToolParameterType? type,
    String? description,
    bool? required,
    dynamic defaultValue,
    List<String>? enumValues,
  }) {
    return CustomToolParameter(
      name: name ?? this.name,
      type: type ?? this.type,
      description: description ?? this.description,
      required: required ?? this.required,
      defaultValue: defaultValue ?? this.defaultValue,
      enumValues: enumValues ?? this.enumValues,
    );
  }
}

/// HTTP handler configuration
class HttpHandlerConfig {
  final String url;
  final HttpMethod method;
  final Map<String, String>? headers;
  final String? bodyTemplate;

  const HttpHandlerConfig({
    required this.url,
    required this.method,
    this.headers,
    this.bodyTemplate,
  });

  factory HttpHandlerConfig.fromJson(Map<String, dynamic> json) {
    return HttpHandlerConfig(
      url: json['url'] as String? ?? '',
      method: HttpMethod.fromWireValue(json['method'] as String?),
      headers: (json['headers'] as Map<String, dynamic>?)
          ?.cast<String, String>(),
      bodyTemplate: json['bodyTemplate'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'url': url,
      'method': method.wireValue,
      if (headers != null && headers!.isNotEmpty) 'headers': headers,
      if (bodyTemplate != null && bodyTemplate!.isNotEmpty)
        'bodyTemplate': bodyTemplate,
    };
  }

  HttpHandlerConfig copyWith({
    String? url,
    HttpMethod? method,
    Map<String, String>? headers,
    String? bodyTemplate,
  }) {
    return HttpHandlerConfig(
      url: url ?? this.url,
      method: method ?? this.method,
      headers: headers ?? this.headers,
      bodyTemplate: bodyTemplate ?? this.bodyTemplate,
    );
  }
}

/// Script handler configuration
class ScriptHandlerConfig {
  final String command;
  final List<String>? args;
  final String? cwd;
  final int? timeout;
  final bool shell;

  const ScriptHandlerConfig({
    required this.command,
    this.args,
    this.cwd,
    this.timeout,
    this.shell = true,
  });

  factory ScriptHandlerConfig.fromJson(Map<String, dynamic> json) {
    return ScriptHandlerConfig(
      command: json['command'] as String? ?? '',
      args: (json['args'] as List<dynamic>?)?.cast<String>(),
      cwd: json['cwd'] as String?,
      timeout: json['timeout'] as int?,
      shell: json['shell'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'command': command,
      if (args != null && args!.isNotEmpty) 'args': args,
      if (cwd != null && cwd!.isNotEmpty) 'cwd': cwd,
      if (timeout != null) 'timeout': timeout,
      if (!shell) 'shell': shell,
    };
  }

  ScriptHandlerConfig copyWith({
    String? command,
    List<String>? args,
    String? cwd,
    int? timeout,
    bool? shell,
  }) {
    return ScriptHandlerConfig(
      command: command ?? this.command,
      args: args ?? this.args,
      cwd: cwd ?? this.cwd,
      timeout: timeout ?? this.timeout,
      shell: shell ?? this.shell,
    );
  }
}

/// Custom tool definition
class ClaudeCodeCustomTool {
  final String id;
  final String name;
  final String description;
  final List<CustomToolParameter> parameters;
  final CustomToolHandlerType handler;
  final dynamic handlerConfig; // HttpHandlerConfig or ScriptHandlerConfig
  final bool enabled;
  final int createdAt;
  final int updatedAt;

  const ClaudeCodeCustomTool({
    required this.id,
    required this.name,
    required this.description,
    required this.parameters,
    required this.handler,
    required this.handlerConfig,
    required this.enabled,
    required this.createdAt,
    required this.updatedAt,
  });

  /// Get HTTP handler config (if handler type is HTTP)
  HttpHandlerConfig? get httpConfig => handler == CustomToolHandlerType.http
      ? handlerConfig as HttpHandlerConfig
      : null;

  /// Get script handler config (if handler type is script)
  ScriptHandlerConfig? get scriptConfig =>
      handler == CustomToolHandlerType.script
      ? handlerConfig as ScriptHandlerConfig
      : null;

  /// Get the MCP tool name as it will appear in Claude Code
  String get mcpToolName => 'mcp__broski-custom-tools__$name';

  factory ClaudeCodeCustomTool.fromJson(Map<String, dynamic> json) {
    final handlerType = CustomToolHandlerType.fromWireValue(
      json['handler'] as String?,
    );
    final configJson = json['handlerConfig'] as Map<String, dynamic>? ?? {};

    final dynamic config = handlerType == CustomToolHandlerType.http
        ? HttpHandlerConfig.fromJson(configJson)
        : ScriptHandlerConfig.fromJson(configJson);

    return ClaudeCodeCustomTool(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      parameters:
          (json['parameters'] as List<dynamic>?)
              ?.map(
                (e) => CustomToolParameter.fromJson(e as Map<String, dynamic>),
              )
              .toList() ??
          const [],
      handler: handlerType,
      handlerConfig: config,
      enabled: json['enabled'] as bool? ?? true,
      createdAt: json['createdAt'] as int? ?? 0,
      updatedAt: json['updatedAt'] as int? ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    final dynamic configJson = handler == CustomToolHandlerType.http
        ? (handlerConfig as HttpHandlerConfig).toJson()
        : (handlerConfig as ScriptHandlerConfig).toJson();

    return {
      'id': id,
      'name': name,
      'description': description,
      'parameters': parameters.map((e) => e.toJson()).toList(),
      'handler': handler.wireValue,
      'handlerConfig': configJson,
      'enabled': enabled,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }

  ClaudeCodeCustomTool copyWith({
    String? id,
    String? name,
    String? description,
    List<CustomToolParameter>? parameters,
    CustomToolHandlerType? handler,
    dynamic handlerConfig,
    bool? enabled,
    int? createdAt,
    int? updatedAt,
  }) {
    return ClaudeCodeCustomTool(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      parameters: parameters ?? this.parameters,
      handler: handler ?? this.handler,
      handlerConfig: handlerConfig ?? this.handlerConfig,
      enabled: enabled ?? this.enabled,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  /// Create a new empty custom tool with HTTP handler
  factory ClaudeCodeCustomTool.empty() {
    return ClaudeCodeCustomTool(
      id: '',
      name: '',
      description: '',
      parameters: const [],
      handler: CustomToolHandlerType.http,
      handlerConfig: const HttpHandlerConfig(url: '', method: HttpMethod.get),
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    );
  }

  /// Validate the tool definition
  List<String> validate() {
    final errors = <String>[];

    if (name.isEmpty) {
      errors.add('Tool name is required');
    } else if (!RegExp(r'^[a-zA-Z_][a-zA-Z0-9_]*$').hasMatch(name)) {
      errors.add(
        'Tool name must start with a letter or underscore and contain only alphanumeric characters',
      );
    }

    if (description.isEmpty) {
      errors.add('Tool description is required');
    }

    if (handler == CustomToolHandlerType.http) {
      final config = httpConfig;
      if (config == null || config.url.isEmpty) {
        errors.add('HTTP URL is required');
      }
    } else if (handler == CustomToolHandlerType.script) {
      final config = scriptConfig;
      if (config == null || config.command.isEmpty) {
        errors.add('Script command is required');
      }
    }

    // Validate parameters
    final paramNames = <String>{};
    for (final param in parameters) {
      if (param.name.isEmpty) {
        errors.add('Parameter name is required');
      } else if (paramNames.contains(param.name)) {
        errors.add('Duplicate parameter name: ${param.name}');
      }
      paramNames.add(param.name);
    }

    return errors;
  }

  bool get isValid => validate().isEmpty;
}

/// Test result for custom tool
class CustomToolTestResult {
  final bool success;
  final String? result;
  final String? error;

  const CustomToolTestResult({required this.success, this.result, this.error});

  factory CustomToolTestResult.fromJson(Map<String, dynamic> json) {
    return CustomToolTestResult(
      success: json['success'] as bool? ?? false,
      result: json['result'] as String?,
      error: json['error'] as String?,
    );
  }
}

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
  final bool hasLspServers;
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
    this.hasLspServers = false,
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
      hasLspServers: json['hasLspServers'] as bool? ?? false,
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
      if (hasLspServers) 'hasLspServers': hasLspServers,
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
      (hasMcpServers ? 1 : 0) +
      (hasLspServers ? 1 : 0);

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
    bool? hasLspServers,
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
      hasLspServers: hasLspServers ?? this.hasLspServers,
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
