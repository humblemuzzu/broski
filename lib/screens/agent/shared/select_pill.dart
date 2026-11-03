import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// How a [SelectPill] marks the one chosen: tinted in the primary colour, as
/// the app's variant chips do, or filled with it, as its effort chips do.
enum SelectPillLook { tinted, filled }

/// The app's selection pill: one choice among several.
class SelectPill extends StatelessWidget {
  const SelectPill({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
    this.look = SelectPillLook.tinted,
    this.dense = false,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final IconData? icon;
  final SelectPillLook look;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final filled = look == SelectPillLook.filled && selected;
    final ink = filled
        ? theme.background
        : selected
        ? theme.primary
        : theme.text;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: dense
            ? const EdgeInsets.symmetric(horizontal: 10, vertical: 5)
            : const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: _decoration(theme, filled: filled),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon case final icon?) ...[
              Icon(icon, size: 13, color: ink),
              const SizedBox(width: Spacing.xs + 1),
            ],
            Flexible(
              child: Text(
                label,
                style: TextStyle(
                  color: ink,
                  fontSize: dense ? 12 : 13,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  BoxDecoration _decoration(OpenCodeTheme theme, {required bool filled}) =>
      BoxDecoration(
        color: filled
            ? theme.primary
            : selected
            ? theme.primary.withValues(alpha: 0.15)
            : theme.bgRaised,
        borderRadius: Radii.brXl,
        border: Border.all(
          color: selected ? theme.primary : theme.borderSubtle,
          width: selected && !filled ? 1.5 : 1,
        ),
      );
}
