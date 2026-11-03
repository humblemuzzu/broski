import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// A short label on a tinted capsule: a status, a badge, a scope.
class Pill extends StatelessWidget {
  const Pill({super.key, required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: Radii.brFull,
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: Text(text, style: AppTypography.caption(color: color)),
    ),
  );
}
