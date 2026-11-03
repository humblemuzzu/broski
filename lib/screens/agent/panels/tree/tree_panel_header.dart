import 'package:broski/screens/agent/panels/tree/tree_model.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Above the tree: which nodes are shown, how many of them there are, and the
/// way to read the tree again.
class TreePanelHeader extends StatelessWidget {
  const TreePanelHeader({
    super.key,
    required this.filter,
    required this.shown,
    required this.total,
    required this.loading,
    required this.onFilter,
    required this.onRefresh,
  });

  final TreeFilter filter;
  final int shown;
  final int total;
  final bool loading;
  final ValueChanged<TreeFilter> onFilter;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Spacing.md,
        Spacing.sm,
        Spacing.sm,
        Spacing.xs,
      ),
      child: Row(
        children: [
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                key: const ValueKey('tree-filter'),
                children: [
                  for (final option in TreeFilter.values)
                    Padding(
                      padding: const EdgeInsets.only(right: Spacing.xs),
                      child: _FilterChip(
                        option: option,
                        selected: option == filter,
                        onTap: () => onFilter(option),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(width: Spacing.sm),
          Text(
            '$shown / $total',
            style: AppTypography.caption(color: theme.textMuted),
          ),
          const SizedBox(width: Spacing.xs),
          _ReadAgain(loading: loading, onTap: onRefresh, theme: theme),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.option,
    required this.selected,
    required this.onTap,
  });

  final TreeFilter option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: selected
                ? theme.primary.withValues(alpha: 0.14)
                : theme.backgroundElement,
            borderRadius: Radii.brFull,
            border: Border.all(
              color: selected
                  ? theme.primary.withValues(alpha: 0.45)
                  : theme.borderSubtle,
            ),
          ),
          child: Text(
            option.label,
            style:
                AppTypography.caption(
                  color: selected ? theme.text : theme.textMuted,
                ).copyWith(
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                ),
          ),
        ),
      ),
    );
  }
}

class _ReadAgain extends StatelessWidget {
  const _ReadAgain({
    required this.loading,
    required this.onTap,
    required this.theme,
  });

  final bool loading;
  final VoidCallback onTap;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    enabled: !loading,
    label: 'Read again',
    child: GestureDetector(
      key: const ValueKey('tree-refresh'),
      onTap: loading ? null : onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.all(5),
        decoration: BoxDecoration(
          color: theme.backgroundElement,
          borderRadius: Radii.brXs,
        ),
        child: Icon(
          AppIcons.refresh,
          size: 14,
          color: loading ? theme.border : theme.textMuted,
        ),
      ),
    ),
  );
}
