/// Glow style for the prompt/input bar border.
enum GlowStyle {
  /// No glow at all - clean/minimal look
  none('None'),

  /// Glow only on the left edge
  leftOnly('Left Only'),

  /// Glow along the full visible border (left + top + right for CLI, all around for ChatGPT)
  fullBorder('Full Border');

  const GlowStyle(this.displayName);

  /// Human-readable name for display in UI
  final String displayName;

  /// Parse from string (for persistence)
  static GlowStyle fromString(String? value) {
    if (value == null) return GlowStyle.fullBorder;
    return GlowStyle.values.firstWhere(
      (s) => s.name == value,
      orElse: () => GlowStyle.fullBorder,
    );
  }
}
