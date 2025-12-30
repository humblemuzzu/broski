import 'package:flutter/material.dart';

/// Professional, aesthetic highlight colors that work across all themes.
/// These are carefully chosen English colors that provide good contrast
/// on both light and dark backgrounds without being garish.
enum HighlightColor {
  /// Warm amber - default, works well on all backgrounds
  amber('Amber', Color(0xFFD97706), Color(0xFFF59E0B)),

  /// Soft coral - warm and inviting
  coral('Coral', Color(0xFFE07A5F), Color(0xFFF4A289)),

  /// Muted teal - professional and calm
  teal('Teal', Color(0xFF0D9488), Color(0xFF2DD4BF)),

  /// Steel blue - classic and trustworthy
  steel('Steel', Color(0xFF4B7BEC), Color(0xFF6C8EEF)),

  /// Sage green - natural and calming
  sage('Sage', Color(0xFF6B8E6B), Color(0xFF8AAB8A)),

  /// Dusty rose - subtle and elegant
  rose('Rose', Color(0xFFB5838D), Color(0xFFD4A5AD)),

  /// Slate gray - minimal and understated
  slate('Slate', Color(0xFF64748B), Color(0xFF94A3B8)),

  /// Golden ochre - warm and distinguished
  ochre('Ochre', Color(0xFFB8860B), Color(0xFFDAA520));

  const HighlightColor(this.displayName, this.darkColor, this.lightColor);

  /// Human-readable name for display in UI
  final String displayName;

  /// Color optimized for dark themes (more saturated)
  final Color darkColor;

  /// Color optimized for light themes (lighter, more pastel)
  final Color lightColor;

  /// Get the appropriate color based on theme brightness
  Color forBrightness(Brightness brightness) {
    return brightness == Brightness.dark ? darkColor : lightColor;
  }

  /// Get background color with appropriate opacity for highlighting
  Color backgroundFor(Brightness brightness) {
    final base = forBrightness(brightness);
    return base.withValues(alpha: brightness == Brightness.dark ? 0.08 : 0.12);
  }

  /// Get border color for highlighted items
  Color borderFor(Brightness brightness) {
    final base = forBrightness(brightness);
    return base.withValues(alpha: brightness == Brightness.dark ? 0.4 : 0.5);
  }

  /// Parse from string (for persistence)
  static HighlightColor fromString(String? value) {
    if (value == null) return HighlightColor.amber;
    return HighlightColor.values.firstWhere(
      (c) => c.name == value,
      orElse: () => HighlightColor.amber,
    );
  }
}
