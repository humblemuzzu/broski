import 'package:flutter/material.dart';

import '../../theme/opencode_theme.dart';

/// Shared section header for action sheets.
///
/// Renders an uppercase label with muted color and letter spacing.
/// Used across all agent actions content files.
class SectionHeader extends StatelessWidget {
  const SectionHeader({
    super.key,
    required this.title,
    required this.theme,
    this.color,
  });

  final String title;
  final OpenCodeTheme theme;

  /// Override color (e.g. danger zone uses `theme.error.withValues(alpha: 0.7)`).
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        color: color ?? theme.textMuted,
        letterSpacing: 0.5,
      ),
    );
  }
}
