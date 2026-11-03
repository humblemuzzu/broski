import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A one-line notice in place of a sidebar section's content: its empty state.
class SidebarNotice extends StatelessWidget {
  const SidebarNotice({
    super.key,
    required this.icon,
    required this.message,
    this.iconColor,
  });

  final IconData icon;
  final String message;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle, width: 1),
      ),
      child: Row(
        children: [
          Icon(icon, color: iconColor ?? theme.textMuted, size: 16),
          const SizedBox(width: Spacing.sm),
          Text(message, style: AppTypography.bodySmall(color: theme.textMuted)),
        ],
      ),
    );
  }
}
