import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The small round mark on a choice: filled and ticked once chosen, a square
/// instead of a circle where several answers may be chosen.
class ChoiceMark extends StatelessWidget {
  const ChoiceMark({
    super.key,
    required this.selected,
    this.square = false,
    this.icon,
  });

  final bool selected;
  final bool square;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      width: 20,
      height: 20,
      decoration: BoxDecoration(
        color: selected ? theme.primary : Colors.transparent,
        shape: square ? BoxShape.rectangle : BoxShape.circle,
        borderRadius: square ? Radii.brXs : null,
        border: Border.all(
          color: selected
              ? theme.primary
              : theme.textMuted.withValues(alpha: 0.3),
          width: 1.5,
        ),
      ),
      child: selected
          ? Icon(AppIcons.check, size: 14, color: theme.selectedListItemText)
          : switch (icon) {
              final icon? => Icon(
                icon,
                size: 11,
                color: theme.textMuted.withValues(alpha: 0.4),
              ),
              null => null,
            },
    );
  }
}
