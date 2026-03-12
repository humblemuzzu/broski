// ── SDK 0.2.42: Thinking Option ──────────────────────────────────────────
sealed class ClaudeCodeThinkingOption {
  const ClaudeCodeThinkingOption();

  factory ClaudeCodeThinkingOption.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String? ?? 'adaptive';
    switch (type) {
      case 'enabled':
        return ClaudeCodeThinkingEnabled(
          budgetTokens: (json['budgetTokens'] as num?)?.toInt() ?? 16384,
        );
      case 'disabled':
        return const ClaudeCodeThinkingDisabled();
      case 'adaptive':
      default:
        return const ClaudeCodeThinkingAdaptive();
    }
  }

  Map<String, dynamic> toJson();
  String get displayName;
}

class ClaudeCodeThinkingAdaptive extends ClaudeCodeThinkingOption {
  const ClaudeCodeThinkingAdaptive();
  @override
  Map<String, dynamic> toJson() => {'type': 'adaptive'};
  @override
  String get displayName => 'Adaptive';
}

class ClaudeCodeThinkingEnabled extends ClaudeCodeThinkingOption {
  final int budgetTokens;
  const ClaudeCodeThinkingEnabled({required this.budgetTokens});
  @override
  Map<String, dynamic> toJson() => {
    'type': 'enabled',
    'budgetTokens': budgetTokens,
  };
  @override
  String get displayName => 'Fixed ($budgetTokens)';
}

class ClaudeCodeThinkingDisabled extends ClaudeCodeThinkingOption {
  const ClaudeCodeThinkingDisabled();
  @override
  Map<String, dynamic> toJson() => {'type': 'disabled'};
  @override
  String get displayName => 'Disabled';
}

// ── SDK 0.2.42: Effort Level ─────────────────────────────────────────────
enum ClaudeCodeEffort {
  low('low', 'Low'),
  medium('medium', 'Medium'),
  high('high', 'High'),
  max('max', 'Max');

  final String wireValue;
  final String displayName;
  const ClaudeCodeEffort(this.wireValue, this.displayName);

  static ClaudeCodeEffort? fromWireValue(String? value) {
    if (value == null) return null;
    return ClaudeCodeEffort.values.cast<ClaudeCodeEffort?>().firstWhere(
      (e) => e!.wireValue == value,
      orElse: () => null,
    );
  }
}
