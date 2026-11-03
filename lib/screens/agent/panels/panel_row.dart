import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One action of a sheet: an icon in a tinted box, the name of the action,
/// and what it does under it.
class PanelRow extends StatelessWidget {
  const PanelRow({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.subtitle,
    this.color,
    this.enabled = true,
  });

  final IconData icon;
  final String label;
  final String? subtitle;
  final VoidCallback onTap;
  final Color? color;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final tone = enabled ? (color ?? theme.text) : theme.textMuted;
    return GestureDetector(
      onTap: enabled ? onTap : null,
      behavior: HitTestBehavior.opaque,
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
                color: tone.withValues(alpha: 0.1),
                borderRadius: Radii.brSm,
              ),
              child: Icon(icon, size: 18, color: tone),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: AppTypography.labelLarge(color: tone)),
                  if (subtitle case final subtitle?)
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
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
