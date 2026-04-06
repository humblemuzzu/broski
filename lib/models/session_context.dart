import 'package:broski/utils/format_utils.dart';
// Session context information for sidebar display
// Includes token usage, cost, LSP servers, and modified files

class SessionContext {
  const SessionContext({
    required this.tokens,
    required this.cost,
    required this.lsp,
    required this.modifiedFiles,
    this.budgetLimitUsd,
  });

  final TokenUsage tokens;
  final double cost;
  final List<LspServer> lsp;
  final List<ModifiedFile> modifiedFiles;
  final double? budgetLimitUsd;

  factory SessionContext.fromJson(Map<String, dynamic> json) {
    return SessionContext(
      tokens: TokenUsage.fromJson(
        json['tokens'] as Map<String, dynamic>? ?? const {},
      ),
      cost: (json['cost'] as num?)?.toDouble() ?? 0.0,
      lsp: (json['lsp'] as List<dynamic>? ?? [])
          .map((item) => LspServer.fromJson(item as Map<String, dynamic>))
          .toList(),
      modifiedFiles: (json['modifiedFiles'] as List<dynamic>? ?? [])
          .map((item) => ModifiedFile.fromJson(item as Map<String, dynamic>))
          .toList(),
      budgetLimitUsd: (json['budgetLimitUsd'] as num?)?.toDouble(),
    );
  }

  /// Empty context for initial state
  factory SessionContext.empty() {
    return const SessionContext(
      tokens: TokenUsage(
        input: 0,
        output: 0,
        total: 0,
        contextTokens: 0,
        contextWindow: kDefaultContextWindow,
      ),
      cost: 0.0,
      lsp: [],
      modifiedFiles: [],
      budgetLimitUsd: null,
    );
  }

  /// Create context from Claude Code token usage (cumulative from SDK result)
  /// The SDK provides cumulative totals and cost in the result message.
  /// SDK usage.iterations provides per-turn breakdowns — the last message
  /// iteration's tokens reflect actual context window occupancy.
  factory SessionContext.fromClaudeCode({
    int inputTokens = 0,
    int outputTokens = 0,
    int cacheReadTokens = 0,
    int cacheWriteTokens = 0,
    int reasoningTokens = 0,
    double? totalCostUsd,
    double? budgetLimitUsd,
    List<ModifiedFile> modifiedFiles = const [],
    int contextWindow =
        kDefaultContextWindow, // SDK v2.1.6+: Allow custom context window
    // Per-turn context tokens from SDK usage.iterations[-1].
    // This is the actual context window occupancy (input + cacheRead + cacheWrite
    // for a single API call), NOT cumulative across all turns.
    int? lastIterContextTokens,
  }) {
    // total = fresh tokens only (what the user sees as "usage")
    // contextTokens = actual context window occupancy (for % bar)
    //
    // Data paths:
    //   1. Live SDK result: cumulative fields + lastIterContextTokens (from iterations[-1])
    //      → use lastIterContextTokens (accurate per-turn)
    //   2. RTS per-message replay: per-turn fields, no lastIterContextTokens
    //      → input + cacheRead + cacheWrite IS per-turn context (correct)
    final total = inputTokens + outputTokens;
    final contextTokens =
        lastIterContextTokens ??
        (inputTokens + cacheReadTokens + cacheWriteTokens);
    return SessionContext(
      tokens: TokenUsage(
        input: inputTokens,
        output: outputTokens,
        total: total,
        contextTokens: contextTokens,
        // Claude's context window varies by model, use passed value or 200K default
        contextWindow: contextWindow,
        reasoning: reasoningTokens > 0 ? reasoningTokens : null,
        cacheRead: cacheReadTokens > 0 ? cacheReadTokens : null,
        cacheWrite: cacheWriteTokens > 0 ? cacheWriteTokens : null,
      ),
      cost: totalCostUsd ?? 0.0,
      lsp: const [], // Claude Code doesn't have LSP
      modifiedFiles: modifiedFiles,
      budgetLimitUsd: budgetLimitUsd,
    );
  }

  /// Create context from Codex token usage (cumulative from SDK stream)
  /// Codex SDK provides: totalTokens, inputTokens, cachedInputTokens,
  /// outputTokens, reasoningOutputTokens, modelContextWindow
  /// NOTE: Codex SDK does NOT provide cost information.
  factory SessionContext.fromCodex({
    int inputTokens = 0,
    int outputTokens = 0,
    int cachedInputTokens = 0,
    int reasoningTokens = 0,
    int cacheWriteTokens = 0,
    int contextWindow = kDefaultContextWindow,
    int contextTokens = 0,
    List<ModifiedFile> modifiedFiles = const [],
  }) {
    final total = inputTokens + outputTokens;
    return SessionContext(
      tokens: TokenUsage(
        input: inputTokens,
        output: outputTokens,
        total: total,
        contextTokens: contextTokens,
        contextWindow: contextWindow,
        reasoning: reasoningTokens > 0 ? reasoningTokens : null,
        cacheRead: cachedInputTokens > 0 ? cachedInputTokens : null,
        cacheWrite: cacheWriteTokens > 0 ? cacheWriteTokens : null,
      ),
      // Codex SDK does not provide cost data
      cost: 0.0,
      lsp: const [],
      modifiedFiles: modifiedFiles,
    );
  }

  /// Create context from Pi session stats and context usage
  /// Pi SDK provides: getSessionStats() with tokens (input, output, cacheRead,
  /// cacheWrite, total) and cost, plus getContextUsage() with tokens, contextWindow, percent
  factory SessionContext.fromPi({
    int inputTokens = 0,
    int outputTokens = 0,
    int cacheReadTokens = 0,
    int cacheWriteTokens = 0,
    int contextWindow = kDefaultContextWindow,

    /// Actual tokens in the context window from Pi's estimateContextTokens.
    /// This is NOT the cumulative cache — it's what's actually occupying the window right now.
    int actualContextTokens = 0,
    double totalCost = 0,
    List<ModifiedFile> modifiedFiles = const [],
  }) {
    final total = inputTokens + outputTokens;
    return SessionContext(
      tokens: TokenUsage(
        input: inputTokens,
        output: outputTokens,
        total: total,
        contextTokens: actualContextTokens > 0
            ? actualContextTokens
            : inputTokens,
        contextWindow: contextWindow,
        cacheRead: cacheReadTokens > 0 ? cacheReadTokens : null,
        cacheWrite: cacheWriteTokens > 0 ? cacheWriteTokens : null,
      ),
      cost: totalCost,
      lsp: const [],
      modifiedFiles: modifiedFiles,
    );
  }

  /// Percentage of context window used (0-100)
  /// Based on contextTokens (input + cache reads + cache writes) which actually
  /// occupy the context window, NOT the total (which is just fresh tokens).
  double get contextUsagePercent {
    if (tokens.contextWindow == 0) return 0;
    return (tokens.contextTokens / tokens.contextWindow * 100).clamp(0, 100);
  }

  /// Formatted cost string
  String get formattedCost {
    if (cost < 0.01) return '\$0.00';
    return '\$${cost.toStringAsFixed(2)}';
  }

  double? get budgetRemainingUsd {
    final limit = budgetLimitUsd;
    if (limit == null) return null;
    return (limit - cost).clamp(0.0, limit);
  }

  String get formattedBudgetRemaining {
    final remaining = budgetRemainingUsd;
    if (remaining == null) return '';
    return '\$${remaining.toStringAsFixed(2)}';
  }
}

class TokenUsage {
  const TokenUsage({
    required this.input,
    required this.output,
    required this.total,
    this.contextTokens = 0,
    required this.contextWindow,
    this.reasoning,
    this.cacheRead,
    this.cacheWrite,
  });

  final int input;
  final int output;

  /// Fresh tokens only: input + output (what the user actually consumed)
  final int total;

  /// Tokens occupying the context window: input + cacheRead + cacheWrite
  /// Used for the context usage % bar
  final int contextTokens;
  final int contextWindow;
  final int? reasoning;
  final int? cacheRead;
  final int? cacheWrite;

  factory TokenUsage.fromJson(Map<String, dynamic> json) {
    final input = json['input'] as int? ?? 0;
    final cacheRead = json['cacheRead'] as int?;
    final cacheWrite = json['cacheWrite'] as int?;
    // Prefer server-computed contextTokens if available; fall back to local calc
    final serverContextTokens = json['contextTokens'] as int?;
    final computedContextTokens = input + (cacheRead ?? 0) + (cacheWrite ?? 0);
    return TokenUsage(
      input: input,
      output: json['output'] as int? ?? 0,
      total: json['total'] as int? ?? 0,
      contextTokens: serverContextTokens ?? computedContextTokens,
      contextWindow: json['contextWindow'] as int? ?? kDefaultContextWindow,
      reasoning: json['reasoning'] as int?,
      cacheRead: cacheRead,
      cacheWrite: cacheWrite,
    );
  }

  /// Format token count with K/M suffix for large numbers.
  /// Instance method for convenience; delegates to the static version.
  String formatCount(int count) => formatTokenCount(count);

  /// Static formatter usable without a TokenUsage instance.
  static String formatTokenCount(int count) {
    if (count >= 1000000) {
      return '${(count / 1000000).toStringAsFixed(1)}M';
    }
    if (count >= 1000) {
      return '${(count / 1000).toStringAsFixed(1)}K';
    }
    return count.toString();
  }
}

class LspServer {
  const LspServer({
    required this.id,
    required this.name,
    required this.status,
    this.language,
    this.root,
  });

  final String id;
  final String name;
  final LspStatus status;
  final String? language;
  final String? root;

  factory LspServer.fromJson(Map<String, dynamic> json) {
    return LspServer(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? 'LSP Server',
      status: _parseStatus(json['status'] as String?),
      language: json['language'] as String?,
      root: json['root'] as String?,
    );
  }

  static LspStatus _parseStatus(String? status) {
    switch (status) {
      case 'running':
        return LspStatus.running;
      case 'error':
        return LspStatus.error;
      default:
        return LspStatus.stopped;
    }
  }

  /// Display name - prefer language, fall back to name
  String get displayName {
    if (language != null && language!.isNotEmpty) {
      return language!;
    }
    return name;
  }

  /// Short root path (just the last directory component)
  String? get shortRoot {
    if (root == null) return null;
    final parts = root!.split('/');
    if (parts.isEmpty) return root;
    // Return last two parts for context
    if (parts.length >= 2) {
      return '../${parts[parts.length - 1]}';
    }
    return parts.last;
  }
}

enum LspStatus { running, stopped, error }

class ModifiedFile {
  const ModifiedFile({
    required this.file,
    required this.additions,
    required this.deletions,
  });

  final String file;
  final int additions;
  final int deletions;

  factory ModifiedFile.fromJson(Map<String, dynamic> json) {
    return ModifiedFile(
      file: json['file'] as String? ?? '',
      additions: json['additions'] as int? ?? 0,
      deletions: json['deletions'] as int? ?? 0,
    );
  }

  /// File name without path
  String get fileName {
    final parts = file.split('/');
    return parts.isNotEmpty ? parts.last : file;
  }

  /// Short path (last 2-3 components)
  String get shortPath {
    final parts = file.split('/');
    if (parts.length <= 2) return file;
    // Take last 3 parts max
    final start = parts.length > 3 ? parts.length - 3 : 0;
    return parts.sublist(start).join('/');
  }

  /// Formatted additions (+X)
  String get formattedAdditions => '+$additions';

  /// Formatted deletions (-X)
  String get formattedDeletions => '-$deletions';

  /// Has any changes
  bool get hasChanges => additions > 0 || deletions > 0;
}
