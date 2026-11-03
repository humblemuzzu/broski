import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One choice of a picker, drawn as the app draws its radio lists: a mark, the
/// name, the line under it, and the row tinted while it is the one in force.
/// A row that cannot be chosen stays in place, muted and inert.
class PickerChoiceRow extends StatelessWidget {
  const PickerChoiceRow({
    super.key,
    required this.label,
    required this.selected,
    this.detail,
    this.trailing,
    this.enabled = true,
    this.onTap,
  });

  final String label;
  final bool selected;
  final String? detail;
  final Widget? trailing;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final marked = selected && enabled;
    return GestureDetector(
      onTap: enabled ? onTap : null,
      behavior: HitTestBehavior.opaque,
      child: Container(
        margin: const EdgeInsets.only(bottom: Spacing.xxs),
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.sm,
          vertical: Spacing.sm,
        ),
        decoration: BoxDecoration(
          color: marked ? theme.backgroundElement : Colors.transparent,
          borderRadius: Radii.brSm,
          border: Border.all(
            color: marked
                ? theme.borderActive.withValues(alpha: 0.5)
                : Colors.transparent,
          ),
        ),
        child: _ChoiceRowBody(
          label: label,
          selected: selected,
          enabled: enabled,
          marked: marked,
          detail: detail,
          trailing: trailing,
        ),
      ),
    );
  }
}

class _ChoiceRowBody extends StatelessWidget {
  const _ChoiceRowBody({
    required this.label,
    required this.selected,
    required this.enabled,
    required this.marked,
    required this.detail,
    required this.trailing,
  });

  final String label;
  final bool selected;
  final bool enabled;
  final bool marked;
  final String? detail;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Icon(
            selected ? AppIcons.radioChecked : AppIcons.radioUnchecked,
            size: 18,
            color: marked ? theme.accent : theme.textMuted,
          ),
        ),
        const SizedBox(width: Spacing.md),
        Expanded(
          child: _ChoiceLabel(
            label: label,
            enabled: enabled,
            marked: marked,
            detail: detail,
          ),
        ),
        if (trailing case final trailing?) ...[
          const SizedBox(width: Spacing.sm),
          trailing,
        ],
      ],
    );
  }
}

class _ChoiceLabel extends StatelessWidget {
  const _ChoiceLabel({
    required this.label,
    required this.enabled,
    required this.marked,
    required this.detail,
  });

  final String label;
  final bool enabled;
  final bool marked;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: AppTypography.bodySmall(
            color: enabled ? theme.text : theme.textMuted,
          ).copyWith(fontWeight: marked ? FontWeight.w600 : null),
        ),
        if (detail case final detail?)
          Padding(
            padding: const EdgeInsets.only(top: Spacing.xxs),
            child: Text(
              detail,
              style: AppTypography.label(color: theme.textMuted),
            ),
          ),
      ],
    );
  }
}
