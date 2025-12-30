import 'package:flutter/material.dart';

/// Professional, aesthetic highlight colors that work across all themes.
/// These are carefully chosen English colors that provide good contrast
/// on both light and dark backgrounds without being garish.
///
/// The 'themePrimary' option uses the current theme's primary color,
/// allowing highlights to match the overall app theme automatically.
enum HighlightColor {
  /// Use theme's primary color - matches your selected theme
  themePrimary('Theme', null, null),

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

  const HighlightColor(this.displayName, this._darkColor, this._lightColor);

  /// Human-readable name for display in UI
  final String displayName;

  /// Color optimized for dark themes (more saturated) - null for themePrimary
  final Color? _darkColor;

  /// Color optimized for light themes (lighter, more pastel) - null for themePrimary
  final Color? _lightColor;

  /// Check if this uses theme primary color
  bool get usesThemePrimary => _darkColor == null;

  /// Get the appropriate color based on theme brightness
  /// Pass themePrimary color when usesThemePrimary is true
  Color forBrightness(Brightness brightness, {Color? themePrimary}) {
    if (usesThemePrimary && themePrimary != null) {
      return themePrimary;
    }
    return brightness == Brightness.dark
        ? (_darkColor ?? const Color(0xFFD97706))
        : (_lightColor ?? const Color(0xFFF59E0B));
  }

  /// Get background color with appropriate opacity for highlighting
  Color backgroundFor(Brightness brightness, {Color? themePrimary}) {
    final base = forBrightness(brightness, themePrimary: themePrimary);
    return base.withValues(alpha: brightness == Brightness.dark ? 0.08 : 0.12);
  }

  /// Get border color for highlighted items
  Color borderFor(Brightness brightness, {Color? themePrimary}) {
    final base = forBrightness(brightness, themePrimary: themePrimary);
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
