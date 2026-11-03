import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One kind of token in the context section's breakdown.
class SidebarTokenRow extends StatelessWidget {
  const SidebarTokenRow({
    super.key,
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.7),
              borderRadius: Radii.brXs,
            ),
          ),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Text(
              label,
              style: AppTypography.caption(color: theme.textMuted),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: theme.text,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
