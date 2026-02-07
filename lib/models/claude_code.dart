import 'command.dart';

enum ClaudeCodePermissionMode {
  defaultMode,
  acceptEdits,
  plan,
  bypassPermissions,
  delegate,
  dontAsk;

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
      case ClaudeCodePermissionMode.delegate:
        return 'delegate';
      case ClaudeCodePermissionMode.dontAsk:
        return 'dontAsk';
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
      case 'delegate':
        return ClaudeCodePermissionMode.delegate;
      case 'dontAsk':
        return ClaudeCodePermissionMode.dontAsk;
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
      case ClaudeCodePermissionMode.delegate:
        return 'Delegate';
      case ClaudeCodePermissionMode.dontAsk:
        return "Don't Ask";
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
  final bool isBackground;

  const ClaudeCodeSession({
    required this.id,
    this.title,
    required this.cwd,
    this.model,
    required this.createdAt,
    required this.updatedAt,
    this.messageCount,
    this.isBackground = false,
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
      isBackground: json['isBackground'] as bool? ?? false,
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
      if (isBackground) 'isBackground': isBackground,
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
  final String? source;
  final String? path;
  final String? agent;
  final String? context;

  const ClaudeCodeSkill({
    required this.name,
    this.description,
    required this.autoInvoke,
    this.tags,
    this.source,
    this.path,
    this.agent,
    this.context,
  });

  factory ClaudeCodeSkill.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeSkill(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      autoInvoke: json['autoInvoke'] as bool? ?? false,
      tags: (json['tags'] as List<dynamic>?)?.cast<String>(),
      source: json['source'] as String?,
      path: json['path'] as String?,
      agent: json['agent'] as String?,
      context: json['context'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      'autoInvoke': autoInvoke,
      if (tags != null) 'tags': tags,
      if (source != null) 'source': source,
      if (path != null) 'path': path,
      if (agent != null) 'agent': agent,
      if (context != null) 'context': context,
    };
  }
}

class ClaudeCodeHook {
  final String id;
  final String event;
  final String? matcher;
  final bool enabled;
  final String? description;
  final List<dynamic>? hooks;
  final String? source;
  final String? path;

  const ClaudeCodeHook({
    required this.id,
    required this.event,
    this.matcher,
    required this.enabled,
    this.description,
    this.hooks,
    this.source,
    this.path,
  });

  factory ClaudeCodeHook.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeHook(
      id: json['id'] as String? ?? '',
      event: json['event'] as String? ?? '',
      matcher: json['matcher'] as String?,
      enabled: json['enabled'] as bool? ?? true,
      description: json['description'] as String?,
      hooks: json['hooks'] as List<dynamic>?,
      source: json['source'] as String?,
      path: json['path'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'event': event,
      if (matcher != null) 'matcher': matcher,
      'enabled': enabled,
      if (description != null) 'description': description,
      if (hooks != null) 'hooks': hooks,
      if (source != null) 'source': source,
      if (path != null) 'path': path,
    };
  }
}

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

class ClaudeCodeSandboxNetworkConfig {
  final List<String>? allowUnixSockets;
  final bool? allowAllUnixSockets;
  final bool? allowLocalBinding;
  final int? httpProxyPort;
  final int? socksProxyPort;

  const ClaudeCodeSandboxNetworkConfig({
    this.allowUnixSockets,
    this.allowAllUnixSockets,
    this.allowLocalBinding,
    this.httpProxyPort,
    this.socksProxyPort,
  });

  factory ClaudeCodeSandboxNetworkConfig.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeSandboxNetworkConfig(
      allowUnixSockets: (json['allowUnixSockets'] as List<dynamic>?)
          ?.map((e) => '$e')
          .toList(),
      allowAllUnixSockets: json['allowAllUnixSockets'] as bool?,
      allowLocalBinding: json['allowLocalBinding'] as bool?,
      httpProxyPort: (json['httpProxyPort'] as num?)?.toInt(),
      socksProxyPort: (json['socksProxyPort'] as num?)?.toInt(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (allowUnixSockets != null) 'allowUnixSockets': allowUnixSockets,
      if (allowAllUnixSockets != null)
        'allowAllUnixSockets': allowAllUnixSockets,
      if (allowLocalBinding != null) 'allowLocalBinding': allowLocalBinding,
      if (httpProxyPort != null) 'httpProxyPort': httpProxyPort,
      if (socksProxyPort != null) 'socksProxyPort': socksProxyPort,
    };
  }
}

class ClaudeCodeSandboxSettings {
  final bool? enabled;
  final bool? autoAllowBashIfSandboxed;
  final bool? allowUnsandboxedCommands;
  final ClaudeCodeSandboxNetworkConfig? network;
  final Map<String, List<String>>? ignoreViolations;
  final bool? enableWeakerNestedSandbox;
  final List<String>? excludedCommands;

  const ClaudeCodeSandboxSettings({
    this.enabled,
    this.autoAllowBashIfSandboxed,
    this.allowUnsandboxedCommands,
    this.network,
    this.ignoreViolations,
    this.enableWeakerNestedSandbox,
    this.excludedCommands,
  });

  factory ClaudeCodeSandboxSettings.fromJson(Map<String, dynamic> json) {
    final ignoreRaw = json['ignoreViolations'];
    final ignore = <String, List<String>>{};
    if (ignoreRaw is Map) {
      for (final entry in ignoreRaw.entries) {
        final key = '${entry.key}';
        final value = entry.value;
        if (value is List) {
          ignore[key] = value.map((e) => '$e').toList();
        }
      }
    }

    return ClaudeCodeSandboxSettings(
      enabled: json['enabled'] as bool?,
      autoAllowBashIfSandboxed: json['autoAllowBashIfSandboxed'] as bool?,
      allowUnsandboxedCommands: json['allowUnsandboxedCommands'] as bool?,
      network: json['network'] is Map<String, dynamic>
          ? ClaudeCodeSandboxNetworkConfig.fromJson(
              json['network'] as Map<String, dynamic>,
            )
          : json['network'] is Map
          ? ClaudeCodeSandboxNetworkConfig.fromJson(
              (json['network'] as Map).cast<String, dynamic>(),
            )
          : null,
      ignoreViolations: ignore.isNotEmpty ? ignore : null,
      enableWeakerNestedSandbox: json['enableWeakerNestedSandbox'] as bool?,
      excludedCommands: (json['excludedCommands'] as List<dynamic>?)
          ?.map((e) => '$e')
          .toList(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (enabled != null) 'enabled': enabled,
      if (autoAllowBashIfSandboxed != null)
        'autoAllowBashIfSandboxed': autoAllowBashIfSandboxed,
      if (allowUnsandboxedCommands != null)
        'allowUnsandboxedCommands': allowUnsandboxedCommands,
      if (network != null) 'network': network!.toJson(),
      if (ignoreViolations != null) 'ignoreViolations': ignoreViolations,
      if (enableWeakerNestedSandbox != null)
        'enableWeakerNestedSandbox': enableWeakerNestedSandbox,
      if (excludedCommands != null) 'excludedCommands': excludedCommands,
    };
  }
}

/// A memory entry from ~/.claude/memory/ (user), .claude/memory/ (project),
/// or ~/.claude/memory-local/ (local).
class ClaudeCodeMemoryEntry {
  final String scope; // 'user' | 'project' | 'local'
  final String filename;
  final String content;
  final String? createdAt;
  final String path;

  const ClaudeCodeMemoryEntry({
    required this.scope,
    required this.filename,
    required this.content,
    this.createdAt,
    required this.path,
  });

  factory ClaudeCodeMemoryEntry.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeMemoryEntry(
      scope: json['scope'] as String? ?? 'user',
      filename: json['filename'] as String? ?? '',
      content: json['content'] as String? ?? '',
      createdAt: json['createdAt'] as String?,
      path: json['path'] as String? ?? '',
    );
  }
}

class ClaudeCodeSupportedModel {
  final String value;
  final String displayName;
  final String description;

  const ClaudeCodeSupportedModel({
    required this.value,
    required this.displayName,
    required this.description,
  });

  factory ClaudeCodeSupportedModel.fromJson(Map<String, dynamic> json) {
    final value = json['value'] as String? ?? '';
    return ClaudeCodeSupportedModel(
      value: value,
      displayName: json['displayName'] as String? ?? value,
      description: json['description'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'value': value,
      'displayName': displayName,
      'description': description,
    };
  }

  bool get supportsOneMillionContext {
    final normalized = value.toLowerCase();
    return normalized.contains('sonnet') ||
        normalized.contains('opus') ||
        normalized.contains('claude-4');
  }
}

class ClaudeCodeAccountInfo {
  final String? email;
  final String? organization;
  final String? subscriptionType;
  final String? tokenSource;
  final String? apiKeySource;

  const ClaudeCodeAccountInfo({
    this.email,
    this.organization,
    this.subscriptionType,
    this.tokenSource,
    this.apiKeySource,
  });

  factory ClaudeCodeAccountInfo.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeAccountInfo(
      email: json['email'] as String?,
      organization: json['organization'] as String?,
      subscriptionType: json['subscriptionType'] as String?,
      tokenSource: json['tokenSource'] as String?,
      apiKeySource: json['apiKeySource'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (email != null) 'email': email,
      if (organization != null) 'organization': organization,
      if (subscriptionType != null) 'subscriptionType': subscriptionType,
      if (tokenSource != null) 'tokenSource': tokenSource,
      if (apiKeySource != null) 'apiKeySource': apiKeySource,
    };
  }
}

class ClaudeCodeMcpServerStatus {
  final String name;
  final String status;
  final String? serverName;
  final String? serverVersion;

  const ClaudeCodeMcpServerStatus({
    required this.name,
    required this.status,
    this.serverName,
    this.serverVersion,
  });

  factory ClaudeCodeMcpServerStatus.fromJson(Map<String, dynamic> json) {
    final infoRaw = json['serverInfo'];
    final info = infoRaw is Map<String, dynamic>
        ? infoRaw
        : infoRaw is Map
        ? infoRaw.cast<String, dynamic>()
        : null;
    return ClaudeCodeMcpServerStatus(
      name: json['name'] as String? ?? '',
      status: json['status'] as String? ?? '',
      serverName: info?['name'] as String?,
      serverVersion: info?['version'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'status': status,
      if (serverName != null || serverVersion != null)
        'serverInfo': {
          if (serverName != null) 'name': serverName,
          if (serverVersion != null) 'version': serverVersion,
        },
    };
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
  final ClaudeCodePermissionMode? permissionMode;
  final List<String>? disallowedTools;

  const ClaudeCodeSubagent({
    required this.name,
    required this.description,
    required this.prompt,
    this.tools,
    this.model = ClaudeCodeSubagentModel.inherit,
    this.permissionMode,
    this.disallowedTools,
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
  }) {
    return ClaudeCodeSubagent(
      name: name ?? this.name,
      description: description ?? this.description,
      prompt: prompt ?? this.prompt,
      tools: tools ?? this.tools,
      model: model ?? this.model,
      permissionMode: permissionMode ?? this.permissionMode,
      disallowedTools: disallowedTools ?? this.disallowedTools,
    );
  }
}

class ClaudeCodeConfig {
  final ClaudeCodePermissionMode permissionMode;
  final List<String> allowedTools;
  final List<String> disallowedTools;
  final String? model;
  final ClaudeCodeSystemPrompt? systemPrompt;
  final int? maxTurns;
  final double? maxBudgetUsd;
  final List<String>? betas;
  final ClaudeCodeSandboxSettings? sandbox;
  final ClaudeCodeOutputFormat? outputFormat;
  final bool? enableAgentTeams;
  final String? language;
  final String? releaseChannel; // 'stable' | 'latest'
  final bool? respectGitignore;
  final List<ClaudeCodeSubagent> subagents;
  final String? activeSubagent;

  const ClaudeCodeConfig({
    required this.permissionMode,
    required this.allowedTools,
    required this.disallowedTools,
    this.model,
    this.systemPrompt,
    this.maxTurns,
    this.maxBudgetUsd,
    this.betas,
    this.sandbox,
    this.outputFormat,
    this.enableAgentTeams,
    this.language,
    this.releaseChannel,
    this.respectGitignore,
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
      maxTurns: (json['maxTurns'] as num?)?.toInt(),
      maxBudgetUsd: (json['maxBudgetUsd'] as num?)?.toDouble(),
      betas: (json['betas'] as List<dynamic>?)?.map((e) => '$e').toList(),
      sandbox: json['sandbox'] is Map<String, dynamic>
          ? ClaudeCodeSandboxSettings.fromJson(
              json['sandbox'] as Map<String, dynamic>,
            )
          : json['sandbox'] is Map
          ? ClaudeCodeSandboxSettings.fromJson(
              (json['sandbox'] as Map).cast<String, dynamic>(),
            )
          : null,
      outputFormat: json['outputFormat'] is Map<String, dynamic>
          ? ClaudeCodeOutputFormat.fromJson(
              json['outputFormat'] as Map<String, dynamic>,
            )
          : json['outputFormat'] is Map
          ? ClaudeCodeOutputFormat.fromJson(
              (json['outputFormat'] as Map).cast<String, dynamic>(),
            )
          : null,
      enableAgentTeams: json['enableAgentTeams'] as bool?,
      language: json['language'] as String?,
      releaseChannel: json['releaseChannel'] as String?,
      respectGitignore: json['respectGitignore'] as bool?,
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
      if (maxTurns != null) 'maxTurns': maxTurns,
      if (maxBudgetUsd != null) 'maxBudgetUsd': maxBudgetUsd,
      if (betas != null && betas!.isNotEmpty) 'betas': betas,
      if (sandbox != null) 'sandbox': sandbox!.toJson(),
      if (outputFormat != null) 'outputFormat': outputFormat!.toJson(),
      if (enableAgentTeams != null) 'enableAgentTeams': enableAgentTeams,
      if (language != null) 'language': language,
      if (releaseChannel != null) 'releaseChannel': releaseChannel,
      if (respectGitignore != null) 'respectGitignore': respectGitignore,
      if (subagents.isNotEmpty)
        'subagents': subagents.map((e) => e.toJson()).toList(),
      if (activeSubagent != null) 'activeSubagent': activeSubagent,
    };
  }

  /// Sentinel used by [copyWith] so callers can explicitly set nullable fields
  /// to `null`. Pass [clearModel] (etc.) to remove the value rather than keep
  /// the old one.  Example:
  /// ```dart
  /// config.copyWith(model: null)   // keeps existing model (no-op)
  /// config.copyWith(clearModel: true) // sets model to null
  /// ```
  ClaudeCodeConfig copyWith({
    ClaudeCodePermissionMode? permissionMode,
    List<String>? allowedTools,
    List<String>? disallowedTools,
    String? model,
    bool clearModel = false,
    ClaudeCodeSystemPrompt? systemPrompt,
    bool clearSystemPrompt = false,
    int? maxTurns,
    bool clearMaxTurns = false,
    double? maxBudgetUsd,
    bool clearMaxBudgetUsd = false,
    List<String>? betas,
    bool clearBetas = false,
    ClaudeCodeSandboxSettings? sandbox,
    bool clearSandbox = false,
    ClaudeCodeOutputFormat? outputFormat,
    bool clearOutputFormat = false,
    bool? enableAgentTeams,
    bool clearEnableAgentTeams = false,
    String? language,
    bool clearLanguage = false,
    String? releaseChannel,
    bool clearReleaseChannel = false,
    bool? respectGitignore,
    bool clearRespectGitignore = false,
    List<ClaudeCodeSubagent>? subagents,
    String? activeSubagent,
    bool clearActiveSubagent = false,
  }) {
    return ClaudeCodeConfig(
      permissionMode: permissionMode ?? this.permissionMode,
      allowedTools: allowedTools ?? this.allowedTools,
      disallowedTools: disallowedTools ?? this.disallowedTools,
      model: clearModel ? null : (model ?? this.model),
      systemPrompt:
          clearSystemPrompt ? null : (systemPrompt ?? this.systemPrompt),
      maxTurns: clearMaxTurns ? null : (maxTurns ?? this.maxTurns),
      maxBudgetUsd:
          clearMaxBudgetUsd ? null : (maxBudgetUsd ?? this.maxBudgetUsd),
      betas: clearBetas ? null : (betas ?? this.betas),
      sandbox: clearSandbox ? null : (sandbox ?? this.sandbox),
      outputFormat:
          clearOutputFormat ? null : (outputFormat ?? this.outputFormat),
      enableAgentTeams: clearEnableAgentTeams
          ? null
          : (enableAgentTeams ?? this.enableAgentTeams),
      language: clearLanguage ? null : (language ?? this.language),
      releaseChannel:
          clearReleaseChannel ? null : (releaseChannel ?? this.releaseChannel),
      respectGitignore: clearRespectGitignore
          ? null
          : (respectGitignore ?? this.respectGitignore),
      subagents: subagents ?? this.subagents,
      activeSubagent:
          clearActiveSubagent ? null : (activeSubagent ?? this.activeSubagent),
    );
  }
}

sealed class ClaudeCodeStreamMessage {
  /// When non-null, this message originated from inside a subagent's execution.
  /// Maps to `parent_tool_use_id` from the Claude Code SDK.
  final String? parentToolUseId;

  const ClaudeCodeStreamMessage({this.parentToolUseId});

  factory ClaudeCodeStreamMessage.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String?;
    switch (type) {
      case 'session-created':
        return CCSessionCreated.fromJson(json);
      case 'session-init':
        return CCSessionInit.fromJson(json);
      case 'compact-boundary':
        return CCCompactBoundary.fromJson(json);
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
    super.parentToolUseId,
  });

  factory CCSessionCreated.fromJson(Map<String, dynamic> json) {
    return CCSessionCreated(
      sessionId: json['sessionId'] as String? ?? '',
      agent: json['agent'] as String? ?? 'claude-code',
      model: json['model'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
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
  final List<ClaudeCodeSupportedModel> supportedModels;
  final ClaudeCodeAccountInfo? accountInfo;
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
    required this.supportedModels,
    this.accountInfo,
    this.apiKeySource,
    this.claudeCodeVersion,
    super.parentToolUseId,
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
      supportedModels:
          (json['supportedModels'] as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .map((item) => ClaudeCodeSupportedModel.fromJson(item))
              .toList() ??
          const [],
      accountInfo: json['accountInfo'] is Map<String, dynamic>
          ? ClaudeCodeAccountInfo.fromJson(
              json['accountInfo'] as Map<String, dynamic>,
            )
          : json['accountInfo'] is Map
          ? ClaudeCodeAccountInfo.fromJson(
              (json['accountInfo'] as Map).cast<String, dynamic>(),
            )
          : null,
      apiKeySource: json['apiKeySource'] as String?,
      claudeCodeVersion: json['claudeCodeVersion'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
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
    super.parentToolUseId,
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
      parentToolUseId: json['parentToolUseId'] as String?,
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
    super.parentToolUseId,
  });

  factory CCCheckpointCreated.fromJson(Map<String, dynamic> json) {
    return CCCheckpointCreated(
      sessionId: json['sessionId'] as String? ?? '',
      checkpointUuid: json['checkpointUuid'] as String? ?? '',
      timestamp: json['timestamp'] as int? ?? 0,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }

  DateTime get timestampDateTime =>
      DateTime.fromMillisecondsSinceEpoch(timestamp);
}

class CCAssistantMessage extends ClaudeCodeStreamMessage {
  final String content;
  final String? messageId;

  const CCAssistantMessage({
    required this.content,
    this.messageId,
    super.parentToolUseId,
  });

  factory CCAssistantMessage.fromJson(Map<String, dynamic> json) {
    return CCAssistantMessage(
      content: json['content'] as String? ?? '',
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCAssistantMessageDelta extends ClaudeCodeStreamMessage {
  final String content;
  final String? messageId;

  const CCAssistantMessageDelta({
    required this.content,
    this.messageId,
    super.parentToolUseId,
  });

  factory CCAssistantMessageDelta.fromJson(Map<String, dynamic> json) {
    return CCAssistantMessageDelta(
      content: json['content'] as String? ?? '',
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCThinkingDelta extends ClaudeCodeStreamMessage {
  final String content;
  final String? partId;
  final String? messageId;

  const CCThinkingDelta({
    required this.content,
    this.partId,
    this.messageId,
    super.parentToolUseId,
  });

  factory CCThinkingDelta.fromJson(Map<String, dynamic> json) {
    return CCThinkingDelta(
      content: json['content'] as String? ?? '',
      partId: json['partId'] as String?,
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
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
    super.parentToolUseId,
  });

  factory CCToolCall.fromJson(Map<String, dynamic> json) {
    return CCToolCall(
      tool: json['tool'] as String? ?? '',
      input: json['input'],
      toolUseId: json['toolUseId'] as String?,
      status: json['status'] as String? ?? 'running',
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
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
    super.parentToolUseId,
  });

  factory CCToolResult.fromJson(Map<String, dynamic> json) {
    return CCToolResult(
      toolUseId: json['toolUseId'] as String?,
      result: json['result'],
      toolUseResult: json['toolUseResult'],
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
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
    super.parentToolUseId,
  });

  factory CCSubagentInvocation.fromJson(Map<String, dynamic> json) {
    return CCSubagentInvocation(
      subagentName: json['subagentName'] as String? ?? 'unknown',
      toolUseId: json['toolUseId'] as String?,
      prompt: json['prompt'] as String?,
      description: json['description'] as String?,
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCCompactBoundary extends ClaudeCodeStreamMessage {
  final String trigger;
  final int preTokens;

  const CCCompactBoundary({
    required this.trigger,
    required this.preTokens,
    super.parentToolUseId,
  });

  factory CCCompactBoundary.fromJson(Map<String, dynamic> json) {
    return CCCompactBoundary(
      trigger: json['trigger'] as String? ?? 'auto',
      preTokens: (json['preTokens'] as num?)?.toInt() ?? 0,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCModelUsage {
  final int inputTokens;
  final int outputTokens;
  final int cacheReadInputTokens;
  final int cacheCreationInputTokens;
  final int webSearchRequests;
  final double costUsd;
  final int contextWindow;

  const CCModelUsage({
    required this.inputTokens,
    required this.outputTokens,
    required this.cacheReadInputTokens,
    required this.cacheCreationInputTokens,
    required this.webSearchRequests,
    required this.costUsd,
    required this.contextWindow,
  });

  factory CCModelUsage.fromJson(Map<String, dynamic> json) {
    return CCModelUsage(
      inputTokens: (json['inputTokens'] as num?)?.toInt() ?? 0,
      outputTokens: (json['outputTokens'] as num?)?.toInt() ?? 0,
      cacheReadInputTokens:
          (json['cacheReadInputTokens'] as num?)?.toInt() ?? 0,
      cacheCreationInputTokens:
          (json['cacheCreationInputTokens'] as num?)?.toInt() ?? 0,
      webSearchRequests: (json['webSearchRequests'] as num?)?.toInt() ?? 0,
      costUsd: (json['costUSD'] as num?)?.toDouble() ?? 0.0,
      contextWindow: (json['contextWindow'] as num?)?.toInt() ?? 0,
    );
  }
}

class CCTokenUsage extends ClaudeCodeStreamMessage {
  final int? inputTokens;
  final int? outputTokens;
  final int? cacheReadTokens;
  final int? cacheCreationTokens;
  final double? totalCostUsd;
  final Map<String, CCModelUsage>? modelUsage;
  final String? messageId;
  // Context window tracking (SDK v2.1.6+)
  final int? contextWindow;

  const CCTokenUsage({
    this.inputTokens,
    this.outputTokens,
    this.cacheReadTokens,
    this.cacheCreationTokens,
    this.totalCostUsd,
    this.modelUsage,
    this.messageId,
    this.contextWindow,
    super.parentToolUseId,
  });

  factory CCTokenUsage.fromJson(Map<String, dynamic> json) {
    final usage = json['usage'] as Map<String, dynamic>? ?? json;
    return CCTokenUsage(
      inputTokens: usage['inputTokens'] as int?,
      outputTokens: usage['outputTokens'] as int?,
      cacheReadTokens: usage['cacheReadTokens'] as int?,
      cacheCreationTokens: usage['cacheCreationTokens'] as int?,
      totalCostUsd: (json['totalCostUsd'] as num?)?.toDouble(),
      modelUsage: json['modelUsage'] is Map<String, dynamic>
          ? (json['modelUsage'] as Map<String, dynamic>).map(
              (key, value) => MapEntry(
                key,
                value is Map<String, dynamic>
                    ? CCModelUsage.fromJson(value)
                    : value is Map
                    ? CCModelUsage.fromJson(value.cast<String, dynamic>())
                    : const CCModelUsage(
                        inputTokens: 0,
                        outputTokens: 0,
                        cacheReadInputTokens: 0,
                        cacheCreationInputTokens: 0,
                        webSearchRequests: 0,
                        costUsd: 0.0,
                        contextWindow: 0,
                      ),
              ),
            )
          : null,
      messageId: json['messageId'] as String?,
      contextWindow:
          usage['contextWindow'] as int? ?? json['contextWindow'] as int?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }

  /// Fresh tokens consumed (input + output only, not cache reads)
  int get totalTokens => (inputTokens ?? 0) + (outputTokens ?? 0);

  /// Effective context window (defaults to Claude 3.5 Sonnet's 200k)
  int get effectiveContextWindow {
    if (contextWindow != null && contextWindow! > 0) return contextWindow!;
    final firstFromModels = modelUsage?.values
        .map((entry) => entry.contextWindow)
        .firstWhere((entry) => entry > 0, orElse: () => 0);
    if (firstFromModels != null && firstFromModels > 0) return firstFromModels;
    return 200000;
  }

  /// Context window used percentage (0-100)
  /// Based on input tokens as per SDK v2.1.6 `context_window.used_percentage`
  double get usedPercentage {
    if (inputTokens == null || inputTokens == 0) return 0.0;
    return ((inputTokens! / effectiveContextWindow) * 100).clamp(0.0, 100.0);
  }

  /// Context window remaining percentage (0-100)
  double get remainingPercentage => 100.0 - usedPercentage;
}

class CCError extends ClaudeCodeStreamMessage {
  final String message;
  final String? code;

  const CCError({required this.message, this.code, super.parentToolUseId});

  factory CCError.fromJson(Map<String, dynamic> json) {
    return CCError(
      message: json['message'] as String? ?? 'Unknown error',
      code: json['code'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCUnknown extends ClaudeCodeStreamMessage {
  final String type;
  final Map<String, dynamic> data;

  const CCUnknown(this.type, this.data, {super.parentToolUseId});
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
  script,
  builtin;

  String get wireValue => name;

  static CustomToolHandlerType fromWireValue(String? value) {
    switch (value) {
      case 'script':
        return CustomToolHandlerType.script;
      case 'builtin':
        return CustomToolHandlerType.builtin;
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
      case CustomToolHandlerType.builtin:
        return 'Built-in';
    }
  }

  String get description {
    switch (this) {
      case CustomToolHandlerType.http:
        return 'Make HTTP requests to external APIs';
      case CustomToolHandlerType.script:
        return 'Execute local scripts or commands';
      case CustomToolHandlerType.builtin:
        return 'Reserved for built-in tools';
    }
  }
}

class BuiltinHandlerConfig {
  final String action;
  final Map<String, dynamic> config;

  const BuiltinHandlerConfig({required this.action, this.config = const {}});

  factory BuiltinHandlerConfig.fromJson(Map<String, dynamic> json) {
    return BuiltinHandlerConfig(
      action: json['action'] as String? ?? '',
      config: json['config'] is Map<String, dynamic>
          ? json['config'] as Map<String, dynamic>
          : const {},
    );
  }

  Map<String, dynamic> toJson() {
    return {'action': action, if (config.isNotEmpty) 'config': config};
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
  final dynamic
  handlerConfig; // HttpHandlerConfig | ScriptHandlerConfig | BuiltinHandlerConfig
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

  BuiltinHandlerConfig? get builtinConfig =>
      handler == CustomToolHandlerType.builtin
      ? handlerConfig as BuiltinHandlerConfig
      : null;

  /// Get the MCP tool name as it will appear in Claude Code
  String get mcpToolName => 'mcp__broski-custom-tools__$name';

  factory ClaudeCodeCustomTool.fromJson(Map<String, dynamic> json) {
    final handlerType = CustomToolHandlerType.fromWireValue(
      json['handler'] as String?,
    );
    final configJson = json['handlerConfig'] as Map<String, dynamic>? ?? {};

    final dynamic config = switch (handlerType) {
      CustomToolHandlerType.http => HttpHandlerConfig.fromJson(configJson),
      CustomToolHandlerType.script => ScriptHandlerConfig.fromJson(configJson),
      CustomToolHandlerType.builtin => BuiltinHandlerConfig.fromJson(
        configJson,
      ),
    };

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
    final dynamic configJson = switch (handler) {
      CustomToolHandlerType.http =>
        (handlerConfig as HttpHandlerConfig).toJson(),
      CustomToolHandlerType.script =>
        (handlerConfig as ScriptHandlerConfig).toJson(),
      CustomToolHandlerType.builtin =>
        (handlerConfig as BuiltinHandlerConfig).toJson(),
    };

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
      (hasMcpServers ? 1 : 0);

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
