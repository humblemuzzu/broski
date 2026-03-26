import 'package:flutter/material.dart';

import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';

/// Row action item for list layout. Extracted from chat_screen.dart.
class ActionRow extends StatelessWidget {
  const ActionRow({
    super.key,
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.theme,
    required this.onTap,
    this.color,
    this.enabled = true,
  });
  final IconData icon;
  final String label;
  final String subtitle;
  final OpenCodeTheme theme;
  final VoidCallback onTap;
  final Color? color;
  final bool enabled;
  @override
  Widget build(BuildContext context) {
    final effectiveColor = enabled ? (color ?? theme.text) : theme.textMuted;
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Container(
        padding: Insets.cardMd,
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: Radii.brMd,
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          children: [
            Container(
              padding: Insets.cardXs,
              decoration: BoxDecoration(
                color: effectiveColor.withValues(alpha: 0.1),
                borderRadius: Radii.brSm,
              ),
              child: Icon(icon, size: 18, color: effectiveColor),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 14,
                      color: effectiveColor,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: AppTypography.label(color: theme.textMuted),
                  ),
                ],
              ),
            ),
            Icon(AppIcons.chevronRight, size: 20, color: theme.textMuted),
          ],
        ),
      ),
    );
  }
}
