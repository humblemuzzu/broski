import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Banner shown when Codex enters/exits review mode.
class CxReviewModeIndicator extends StatelessWidget {
  const CxReviewModeIndicator({
    super.key,
    required this.entered,
    this.reviewType,
  });

  /// True = entered review mode, False = exited review mode.
  final bool entered;

  /// Optional description of what's being reviewed.
  final String? reviewType;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final icon = entered ? '📋' : '✅';
    final label = entered ? 'Entered Review Mode' : 'Exited Review Mode';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: [
          Expanded(child: Divider(color: theme.border, height: 1)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(icon, style: const TextStyle(fontSize: 12)),
                const SizedBox(width: 4),
                Text(label, style: AppTypography.label(color: theme.textMuted)),
                if (reviewType != null) ...[
                  const SizedBox(width: 4),
                  Text(
                    '($reviewType)',
                    style: AppTypography.label(color: theme.textMuted),
                  ),
                ],
              ],
            ),
          ),
          Expanded(child: Divider(color: theme.border, height: 1)),
        ],
      ),
    );
  }
}
