import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A setting of a form that is picked in a sheet of its own: the app's card,
/// its icon, what is set now, and the way into the choices.
class PickerFieldRow extends StatelessWidget {
  const PickerFieldRow({
    super.key,
    required this.icon,
    required this.value,
    required this.onTap,
  });

  final IconData icon;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
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
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: theme.accent.withValues(alpha: 0.12),
                borderRadius: Radii.brSm,
              ),
              child: Icon(icon, size: 16, color: theme.accent),
            ),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.labelLarge(color: theme.text),
              ),
            ),
            const SizedBox(width: Spacing.sm),
            Icon(AppIcons.chevronRight, size: 18, color: theme.textMuted),
          ],
        ),
      ),
    );
  }
}
