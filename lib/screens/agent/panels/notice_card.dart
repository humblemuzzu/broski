import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// What the backend answered, said on its own in the colour of what it means.
class NoticeCard extends StatelessWidget {
  const NoticeCard({
    super.key,
    required this.text,
    required this.color,
    this.icon,
  });

  final String text;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Container(
    padding: Insets.cardSm,
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.08),
      borderRadius: Radii.brSm,
      border: Border.all(color: color.withValues(alpha: 0.25)),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (icon case final icon?) ...[
          Icon(icon, size: 16, color: color),
          const SizedBox(width: Spacing.sm),
        ],
        Expanded(
          child: Text(text, style: AppTypography.bodySmall(color: color)),
        ),
      ],
    ),
  );
}
