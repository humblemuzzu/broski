import 'package:flutter/material.dart';
import '../theme/app_typography.dart';

import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';

/// A small pill badge showing the AI thinking variant level (e.g., high, max, low).
///
/// Used in:
/// - `message_bubble.dart` (on assistant messages)
/// - `chat_screen.dart` (in agent picker)
///
/// Returns [SizedBox.shrink] when [variant] is null or empty.
class VariantBadge extends StatelessWidget {
  const VariantBadge({super.key, required this.variant, this.isSmall = true});

  final String? variant;
  final bool isSmall;

  /// Small badge for inline use (message bubbles, lists).
  const VariantBadge.small({super.key, required this.variant}) : isSmall = true;

  /// Larger badge for pickers and dialogs.
  const VariantBadge.medium({super.key, required this.variant})
    : isSmall = false;

  @override
  Widget build(BuildContext context) {
    if (variant == null || variant!.isEmpty) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    final color = _variantColor(theme, variant!);

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isSmall ? 7 : 9,
        vertical: isSmall ? 2 : 3,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: Radii.brFull,
        border: Border.all(color: color.withValues(alpha: 0.3), width: 1),
      ),
      child: Text(
        variant!,
        style: TextStyle(
          fontFamily: AppTypography.uiFontFamily,
          fontSize: isSmall ? 10 : 11,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }

  static Color _variantColor(OpenCodeTheme theme, String variant) {
    switch (variant.toLowerCase()) {
      case 'high':
        return theme.warning;
      case 'max':
        return theme.accent;
      case 'low':
        return theme.textMuted;
      case 'none':
        return theme.textMuted;
      default:
        return theme.info;
    }
  }
}
