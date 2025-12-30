import 'package:flutter/material.dart';

/// Accent colors for the prompt/input bar.
/// Uses theme-aware colors that work across all themes.
enum PromptAccentColor {
  /// Theme primary - uses the current theme's primary color
  themePrimary('Theme', null),

  /// Warm amber - warm and inviting
  amber('Amber', Color(0xFFD97706)),

  /// Coral - warm and soft
  coral('Coral', Color(0xFFE07A5F)),

  /// Teal - professional and calm
  teal('Teal', Color(0xFF0D9488)),

  /// Steel blue - classic and trustworthy
  steel('Steel', Color(0xFF4B7BEC)),

  /// Sage green - natural and calming
  sage('Sage', Color(0xFF6B8E6B)),

  /// Rose - subtle and elegant
  rose('Rose', Color(0xFFB5838D)),

  /// Mint - fresh and clean
  mint('Mint', Color(0xFF2DD4BF)),

  /// Gold - warm and distinguished
  gold('Gold', Color(0xFFDAA520));

  const PromptAccentColor(this.displayName, this.color);

  /// Human-readable name for display in UI
  final String displayName;

  /// Fixed color value (null means use theme primary)
  final Color? color;

  /// Get the actual color to use, falling back to theme primary
  Color getColor(Color themePrimary) {
    return color ?? themePrimary;
  }

  /// Parse from string (for persistence)
  static PromptAccentColor fromString(String? value) {
    if (value == null) return PromptAccentColor.themePrimary;
    return PromptAccentColor.values.firstWhere(
      (c) => c.name == value,
      orElse: () => PromptAccentColor.themePrimary,
    );
  }
}
