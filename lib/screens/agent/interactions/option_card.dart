import 'package:broski/screens/agent/interactions/choice_mark.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One answer in the app's option-card language: a rounded card that marks
/// itself when chosen and carries its label over its detail.
class OptionCard extends StatelessWidget {
  const OptionCard({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.multi = false,
    this.detail,
    this.markIcon,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final bool multi;
  final Widget? detail;
  final IconData? markIcon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: Insets.bottomSm,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: Radii.brMd,
          child: _OptionSurface(
            label: label,
            selected: selected,
            multi: multi,
            detail: detail,
            markIcon: markIcon,
          ),
        ),
      ),
    );
  }
}

class _OptionSurface extends StatelessWidget {
  const _OptionSurface({
    required this.label,
    required this.selected,
    required this.multi,
    required this.detail,
    required this.markIcon,
  });

  final String label;
  final bool selected;
  final bool multi;
  final Widget? detail;
  final IconData? markIcon;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: selected
            ? theme.primary.withValues(alpha: 0.08)
            : theme.bgRaised,
        borderRadius: Radii.brMd,
        border: Border.all(
          color: selected
              ? theme.primary.withValues(alpha: 0.5)
              : theme.borderSubtle.withValues(alpha: 0.2),
          width: selected ? 1.5 : 1,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: ChoiceMark(
              selected: selected,
              square: multi,
              icon: markIcon,
            ),
          ),
          const SizedBox(width: Spacing.md),
          Expanded(
            child: _OptionLabel(
              label: label,
              selected: selected,
              detail: detail,
            ),
          ),
        ],
      ),
    );
  }
}

class _OptionLabel extends StatelessWidget {
  const _OptionLabel({
    required this.label,
    required this.selected,
    required this.detail,
  });

  final String label;
  final bool selected;
  final Widget? detail;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: selected ? theme.text : theme.text.withValues(alpha: 0.85),
            fontSize: 13.5,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
        if (detail case final detail?)
          Padding(
            padding: const EdgeInsets.only(top: Spacing.xs),
            child: DefaultTextStyle.merge(
              style: AppTypography.bodySmall(color: theme.textMuted),
              child: detail,
            ),
          ),
      ],
    );
  }
}
