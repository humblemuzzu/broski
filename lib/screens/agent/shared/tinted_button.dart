import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A small action at the foot of a panel, drawn as the app draws its own:
/// an icon and a word in a tinted capsule.
class TintedButton extends StatelessWidget {
  const TintedButton({
    super.key,
    required this.label,
    this.icon,
    required this.onTap,
    this.color,
  });

  final IconData? icon;
  final String label;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final tone = onTap == null ? theme.textMuted : (color ?? theme.primary);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: 0.1),
          borderRadius: Radii.brSm,
          border: Border.all(color: tone.withValues(alpha: 0.3)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon case final icon?) ...[
              Icon(icon, size: 16, color: tone),
              const SizedBox(width: Spacing.sm),
            ],
            Text(label, style: AppTypography.label(color: tone)),
          ],
        ),
      ),
    );
  }
}
