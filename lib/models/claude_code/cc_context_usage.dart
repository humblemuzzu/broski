/// Context window usage breakdown from Claude Code SDK `getContextUsage()`.
///
/// Provides detailed token-level breakdown of what's occupying the context window:
/// categories, memory files, MCP tools, agents, skills, message breakdown, and API usage.
class CCContextUsage {
  final List<CCContextCategory> categories;
  final int totalTokens;
  final int maxTokens;
  final int rawMaxTokens;
  final double percentage;
  final String model;
  final List<CCMemoryFileUsage> memoryFiles;
  final List<CCMcpToolUsage> mcpTools;
  final List<CCDeferredBuiltinTool>? deferredBuiltinTools;
  final List<CCSystemTool>? systemTools;
  final List<CCAgentUsage> agents;
  final CCSlashCommandUsage? slashCommands;
  final CCSkillUsage? skills;
  final int? autoCompactThreshold;
  final bool isAutoCompactEnabled;
  final CCMessageBreakdown? messageBreakdown;
  final CCApiUsage? apiUsage;

  const CCContextUsage({
    required this.categories,
    required this.totalTokens,
    required this.maxTokens,
    required this.rawMaxTokens,
    required this.percentage,
    required this.model,
    required this.memoryFiles,
    required this.mcpTools,
    this.deferredBuiltinTools,
    this.systemTools,
    required this.agents,
    this.slashCommands,
    this.skills,
    this.autoCompactThreshold,
    required this.isAutoCompactEnabled,
    this.messageBreakdown,
    this.apiUsage,
  });

  factory CCContextUsage.fromJson(Map<String, dynamic> json) {
    return CCContextUsage(
      categories: _parseList(json['categories'], CCContextCategory.fromJson),
      totalTokens: (json['totalTokens'] as num?)?.toInt() ?? 0,
      maxTokens: (json['maxTokens'] as num?)?.toInt() ?? 0,
      rawMaxTokens: (json['rawMaxTokens'] as num?)?.toInt() ?? 0,
      percentage: (json['percentage'] as num?)?.toDouble() ?? 0,
      model: json['model'] as String? ?? '',
      memoryFiles: _parseList(json['memoryFiles'], CCMemoryFileUsage.fromJson),
      mcpTools: _parseList(json['mcpTools'], CCMcpToolUsage.fromJson),
      deferredBuiltinTools: json['deferredBuiltinTools'] != null
          ? _parseList(
              json['deferredBuiltinTools'],
              CCDeferredBuiltinTool.fromJson,
            )
          : null,
      systemTools: json['systemTools'] != null
          ? _parseList(json['systemTools'], CCSystemTool.fromJson)
          : null,
      agents: _parseList(json['agents'], CCAgentUsage.fromJson),
      slashCommands: json['slashCommands'] != null
          ? CCSlashCommandUsage.fromJson(
              json['slashCommands'] as Map<String, dynamic>,
            )
          : null,
      skills: json['skills'] != null
          ? CCSkillUsage.fromJson(json['skills'] as Map<String, dynamic>)
          : null,
      autoCompactThreshold: (json['autoCompactThreshold'] as num?)?.toInt(),
      isAutoCompactEnabled: json['isAutoCompactEnabled'] as bool? ?? false,
      messageBreakdown: json['messageBreakdown'] != null
          ? CCMessageBreakdown.fromJson(
              json['messageBreakdown'] as Map<String, dynamic>,
            )
          : null,
      apiUsage: json['apiUsage'] != null
          ? CCApiUsage.fromJson(json['apiUsage'] as Map<String, dynamic>)
          : null,
    );
  }
}

class CCContextCategory {
  final String name;
  final int tokens;
  final String color;
  final bool? isDeferred;

  const CCContextCategory({
    required this.name,
    required this.tokens,
    required this.color,
    this.isDeferred,
  });

  factory CCContextCategory.fromJson(Map<String, dynamic> json) {
    return CCContextCategory(
      name: json['name'] as String? ?? '',
      tokens: (json['tokens'] as num?)?.toInt() ?? 0,
      color: json['color'] as String? ?? '#888888',
      isDeferred: json['isDeferred'] as bool?,
    );
  }

  /// Percentage of total context this category uses.
  double percentOf(int total) => total > 0 ? (tokens / total * 100) : 0;
}

class CCMemoryFileUsage {
  final String path;
  final String type;
  final int tokens;

  const CCMemoryFileUsage({
    required this.path,
    required this.tokens,
    required this.type,
  });

  factory CCMemoryFileUsage.fromJson(Map<String, dynamic> json) {
    return CCMemoryFileUsage(
      path: json['path'] as String? ?? '',
      type: json['type'] as String? ?? '',
      tokens: (json['tokens'] as num?)?.toInt() ?? 0,
    );
  }

  /// Short display name: just the filename, not the full path.
  String get displayName {
    final parts = path.split('/');
    return parts.isNotEmpty ? parts.last : path;
  }
}

class CCMcpToolUsage {
  final String name;
  final String serverName;
  final int tokens;
  final bool? isLoaded;

  const CCMcpToolUsage({
    required this.name,
    required this.serverName,
    required this.tokens,
    this.isLoaded,
  });

  factory CCMcpToolUsage.fromJson(Map<String, dynamic> json) {
    return CCMcpToolUsage(
      name: json['name'] as String? ?? '',
      serverName: json['serverName'] as String? ?? '',
      tokens: (json['tokens'] as num?)?.toInt() ?? 0,
      isLoaded: json['isLoaded'] as bool?,
    );
  }
}

class CCDeferredBuiltinTool {
  final String name;
  final int tokens;
  final bool isLoaded;

  const CCDeferredBuiltinTool({
    required this.name,
    required this.tokens,
    required this.isLoaded,
  });

  factory CCDeferredBuiltinTool.fromJson(Map<String, dynamic> json) {
    return CCDeferredBuiltinTool(
      name: json['name'] as String? ?? '',
      tokens: (json['tokens'] as num?)?.toInt() ?? 0,
      isLoaded: json['isLoaded'] as bool? ?? false,
    );
  }
}

class CCSystemTool {
  final String name;
  final int tokens;

  const CCSystemTool({required this.name, required this.tokens});

  factory CCSystemTool.fromJson(Map<String, dynamic> json) {
    return CCSystemTool(
      name: json['name'] as String? ?? '',
      tokens: (json['tokens'] as num?)?.toInt() ?? 0,
    );
  }
}

class CCAgentUsage {
  final String agentType;
  final String source;
  final int tokens;

  const CCAgentUsage({
    required this.agentType,
    required this.source,
    required this.tokens,
  });

  factory CCAgentUsage.fromJson(Map<String, dynamic> json) {
    return CCAgentUsage(
      agentType: json['agentType'] as String? ?? '',
      source: json['source'] as String? ?? '',
      tokens: (json['tokens'] as num?)?.toInt() ?? 0,
    );
  }
}

class CCSlashCommandUsage {
  final int totalCommands;
  final int includedCommands;
  final int tokens;

  const CCSlashCommandUsage({
    required this.totalCommands,
    required this.includedCommands,
    required this.tokens,
  });

  factory CCSlashCommandUsage.fromJson(Map<String, dynamic> json) {
    return CCSlashCommandUsage(
      totalCommands: (json['totalCommands'] as num?)?.toInt() ?? 0,
      includedCommands: (json['includedCommands'] as num?)?.toInt() ?? 0,
      tokens: (json['tokens'] as num?)?.toInt() ?? 0,
    );
  }
}

class CCSkillUsage {
  final int totalSkills;
  final int includedSkills;
  final int tokens;
  final List<CCSkillFrontmatter> skillFrontmatter;

  const CCSkillUsage({
    required this.totalSkills,
    required this.includedSkills,
    required this.tokens,
    required this.skillFrontmatter,
  });

  factory CCSkillUsage.fromJson(Map<String, dynamic> json) {
    return CCSkillUsage(
      totalSkills: (json['totalSkills'] as num?)?.toInt() ?? 0,
      includedSkills: (json['includedSkills'] as num?)?.toInt() ?? 0,
      tokens: (json['tokens'] as num?)?.toInt() ?? 0,
      skillFrontmatter: _parseList(
        json['skillFrontmatter'],
        CCSkillFrontmatter.fromJson,
      ),
    );
  }
}

class CCSkillFrontmatter {
  final String name;
  final String source;
  final int tokens;

  const CCSkillFrontmatter({
    required this.name,
    required this.source,
    required this.tokens,
  });

  factory CCSkillFrontmatter.fromJson(Map<String, dynamic> json) {
    return CCSkillFrontmatter(
      name: json['name'] as String? ?? '',
      source: json['source'] as String? ?? '',
      tokens: (json['tokens'] as num?)?.toInt() ?? 0,
    );
  }
}

class CCMessageBreakdown {
  final int toolCallTokens;
  final int toolResultTokens;
  final int attachmentTokens;
  final int assistantMessageTokens;
  final int userMessageTokens;
  final List<CCToolCallBreakdown> toolCallsByType;
  final List<CCAttachmentBreakdown> attachmentsByType;

  const CCMessageBreakdown({
    required this.toolCallTokens,
    required this.toolResultTokens,
    required this.attachmentTokens,
    required this.assistantMessageTokens,
    required this.userMessageTokens,
    required this.toolCallsByType,
    required this.attachmentsByType,
  });

  factory CCMessageBreakdown.fromJson(Map<String, dynamic> json) {
    return CCMessageBreakdown(
      toolCallTokens: (json['toolCallTokens'] as num?)?.toInt() ?? 0,
      toolResultTokens: (json['toolResultTokens'] as num?)?.toInt() ?? 0,
      attachmentTokens: (json['attachmentTokens'] as num?)?.toInt() ?? 0,
      assistantMessageTokens:
          (json['assistantMessageTokens'] as num?)?.toInt() ?? 0,
      userMessageTokens: (json['userMessageTokens'] as num?)?.toInt() ?? 0,
      toolCallsByType: _parseList(
        json['toolCallsByType'],
        CCToolCallBreakdown.fromJson,
      ),
      attachmentsByType: _parseList(
        json['attachmentsByType'],
        CCAttachmentBreakdown.fromJson,
      ),
    );
  }
}

class CCToolCallBreakdown {
  final String name;
  final int callTokens;
  final int resultTokens;

  const CCToolCallBreakdown({
    required this.name,
    required this.callTokens,
    required this.resultTokens,
  });

  factory CCToolCallBreakdown.fromJson(Map<String, dynamic> json) {
    return CCToolCallBreakdown(
      name: json['name'] as String? ?? '',
      callTokens: (json['callTokens'] as num?)?.toInt() ?? 0,
      resultTokens: (json['resultTokens'] as num?)?.toInt() ?? 0,
    );
  }

  int get totalTokens => callTokens + resultTokens;
}

class CCAttachmentBreakdown {
  final String name;
  final int tokens;

  const CCAttachmentBreakdown({required this.name, required this.tokens});

  factory CCAttachmentBreakdown.fromJson(Map<String, dynamic> json) {
    return CCAttachmentBreakdown(
      name: json['name'] as String? ?? '',
      tokens: (json['tokens'] as num?)?.toInt() ?? 0,
    );
  }
}

class CCApiUsage {
  final int inputTokens;
  final int outputTokens;
  final int cacheCreationInputTokens;
  final int cacheReadInputTokens;

  const CCApiUsage({
    required this.inputTokens,
    required this.outputTokens,
    required this.cacheCreationInputTokens,
    required this.cacheReadInputTokens,
  });

  factory CCApiUsage.fromJson(Map<String, dynamic> json) {
    return CCApiUsage(
      inputTokens: (json['input_tokens'] as num?)?.toInt() ?? 0,
      outputTokens: (json['output_tokens'] as num?)?.toInt() ?? 0,
      cacheCreationInputTokens:
          (json['cache_creation_input_tokens'] as num?)?.toInt() ?? 0,
      cacheReadInputTokens:
          (json['cache_read_input_tokens'] as num?)?.toInt() ?? 0,
    );
  }

  int get totalTokens =>
      inputTokens +
      outputTokens +
      cacheCreationInputTokens +
      cacheReadInputTokens;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

List<T> _parseList<T>(dynamic raw, T Function(Map<String, dynamic>) fromJson) {
  if (raw is! List) return const [];
  return raw
      .whereType<Map<String, dynamic>>()
      .map(fromJson)
      .toList(growable: false);
}

/// Utility: format a token count as human-readable (e.g. "45.2K", "1.2M").
String formatTokenCount(int count) {
  if (count >= 1000000) return '${(count / 1000000).toStringAsFixed(1)}M';
  if (count >= 1000) return '${(count / 1000).toStringAsFixed(1)}K';
  return count.toString();
}
