import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Divider shown in chat when context compaction occurs.
class CxCompactionDivider extends StatelessWidget {
  const CxCompactionDivider({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Expanded(child: Divider(color: theme.border, height: 1)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('🗜️', style: TextStyle(fontSize: 12)),
                const SizedBox(width: 4),
                Text(
                  'Context Compacted',
                  style: AppTypography.label(color: theme.textMuted),
                ),
              ],
            ),
          ),
          Expanded(child: Divider(color: theme.border, height: 1)),
        ],
      ),
    );
  }
}
