import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One figure in the context section's stats row.
class SidebarStatItem extends StatelessWidget {
  const SidebarStatItem({
    super.key,
    required this.label,
    this.sublabel,
    required this.icon,
  });

  final String label;
  final String? sublabel;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle, width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: theme.textMuted),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: theme.text,
              fontWeight: FontWeight.w500,
            ),
          ),
          if (sublabel != null) ...[
            const SizedBox(width: Spacing.xs),
            Text(sublabel!, style: AppTypography.label(color: theme.textMuted)),
          ],
        ],
      ),
    );
  }
}
