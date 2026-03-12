import 'cc_command.dart';
import 'cc_permission.dart';
import 'cc_sandbox.dart';
import 'cc_subagent.dart';
import 'cc_thinking.dart';

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
  final ClaudeCodeThinkingOption? thinking;
  final ClaudeCodeEffort? effort;
  final bool? promptSuggestions;
  final bool? enableClaudeAiMcpServers;
  final String? language;
  final String? releaseChannel; // 'stable' | 'latest'
  final bool? respectGitignore;
  final List<ClaudeCodeSubagent> subagents;
  final String? activeSubagent;
  final bool? agentProgressSummaries;
  final String? fallbackModel;

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
    this.thinking,
    this.effort,
    this.promptSuggestions,
    this.enableClaudeAiMcpServers,
    this.language,
    this.releaseChannel,
    this.respectGitignore,
    this.subagents = const [],
    this.activeSubagent,
    this.agentProgressSummaries,
    this.fallbackModel,
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
      thinking: json['thinking'] is Map<String, dynamic>
          ? ClaudeCodeThinkingOption.fromJson(
              json['thinking'] as Map<String, dynamic>,
            )
          : json['thinking'] is Map
          ? ClaudeCodeThinkingOption.fromJson(
              (json['thinking'] as Map).cast<String, dynamic>(),
            )
          : null,
      effort: ClaudeCodeEffort.fromWireValue(json['effort'] as String?),
      promptSuggestions: json['promptSuggestions'] as bool?,
      enableClaudeAiMcpServers: json['enableClaudeAiMcpServers'] as bool?,
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
      agentProgressSummaries: json['agentProgressSummaries'] as bool?,
      fallbackModel: json['fallbackModel'] as String?,
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
      if (thinking != null) 'thinking': thinking!.toJson(),
      if (effort != null) 'effort': effort!.wireValue,
      if (promptSuggestions != null) 'promptSuggestions': promptSuggestions,
      if (enableClaudeAiMcpServers != null)
        'enableClaudeAiMcpServers': enableClaudeAiMcpServers,
      if (language != null) 'language': language,
      if (releaseChannel != null) 'releaseChannel': releaseChannel,
      if (respectGitignore != null) 'respectGitignore': respectGitignore,
      if (subagents.isNotEmpty)
        'subagents': subagents.map((e) => e.toJson()).toList(),
      if (activeSubagent != null) 'activeSubagent': activeSubagent,
      if (agentProgressSummaries != null)
        'agentProgressSummaries': agentProgressSummaries,
      if (fallbackModel != null) 'fallbackModel': fallbackModel,
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
    ClaudeCodeThinkingOption? thinking,
    bool clearThinking = false,
    ClaudeCodeEffort? effort,
    bool clearEffort = false,
    bool? promptSuggestions,
    bool clearPromptSuggestions = false,
    bool? enableClaudeAiMcpServers,
    bool clearEnableClaudeAiMcpServers = false,
    String? language,
    bool clearLanguage = false,
    String? releaseChannel,
    bool clearReleaseChannel = false,
    bool? respectGitignore,
    bool clearRespectGitignore = false,
    List<ClaudeCodeSubagent>? subagents,
    String? activeSubagent,
    bool clearActiveSubagent = false,
    bool? agentProgressSummaries,
    bool clearAgentProgressSummaries = false,
    String? fallbackModel,
    bool clearFallbackModel = false,
  }) {
    return ClaudeCodeConfig(
      permissionMode: permissionMode ?? this.permissionMode,
      allowedTools: allowedTools ?? this.allowedTools,
      disallowedTools: disallowedTools ?? this.disallowedTools,
      model: clearModel ? null : (model ?? this.model),
      systemPrompt: clearSystemPrompt
          ? null
          : (systemPrompt ?? this.systemPrompt),
      maxTurns: clearMaxTurns ? null : (maxTurns ?? this.maxTurns),
      maxBudgetUsd: clearMaxBudgetUsd
          ? null
          : (maxBudgetUsd ?? this.maxBudgetUsd),
      betas: clearBetas ? null : (betas ?? this.betas),
      sandbox: clearSandbox ? null : (sandbox ?? this.sandbox),
      outputFormat: clearOutputFormat
          ? null
          : (outputFormat ?? this.outputFormat),
      enableAgentTeams: clearEnableAgentTeams
          ? null
          : (enableAgentTeams ?? this.enableAgentTeams),
      thinking: clearThinking ? null : (thinking ?? this.thinking),
      effort: clearEffort ? null : (effort ?? this.effort),
      promptSuggestions: clearPromptSuggestions
          ? null
          : (promptSuggestions ?? this.promptSuggestions),
      enableClaudeAiMcpServers: clearEnableClaudeAiMcpServers
          ? null
          : (enableClaudeAiMcpServers ?? this.enableClaudeAiMcpServers),
      language: clearLanguage ? null : (language ?? this.language),
      releaseChannel: clearReleaseChannel
          ? null
          : (releaseChannel ?? this.releaseChannel),
      respectGitignore: clearRespectGitignore
          ? null
          : (respectGitignore ?? this.respectGitignore),
      subagents: subagents ?? this.subagents,
      activeSubagent: clearActiveSubagent
          ? null
          : (activeSubagent ?? this.activeSubagent),
      agentProgressSummaries: clearAgentProgressSummaries
          ? null
          : (agentProgressSummaries ?? this.agentProgressSummaries),
      fallbackModel: clearFallbackModel
          ? null
          : (fallbackModel ?? this.fallbackModel),
    );
  }
}
