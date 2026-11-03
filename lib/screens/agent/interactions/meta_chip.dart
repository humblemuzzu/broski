import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// One fact about an ask — who asked, whether the run waits, when the
/// backend gives up — as a small tinted pill.
class MetaChip extends StatelessWidget {
  const MetaChip({
    super.key,
    required this.label,
    required this.color,
    this.icon,
  });

  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Container(
    padding: Insets.chip,
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: Radii.brFull,
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon case final icon?) ...[
          Icon(icon, size: 12, color: color),
          const SizedBox(width: Spacing.xs),
        ],
        Flexible(
          child: Text(
            label,
            style: AppTypography.label(color: color),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    ),
  );
}
