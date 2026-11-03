import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Under the tree: whether more of it is on its way, the earlier entries it
/// can still read, and how many it will not show.
class TreePanelFooter extends StatelessWidget {
  const TreePanelFooter({
    super.key,
    required this.loading,
    required this.problem,
    required this.left,
    required this.more,
    required this.shown,
    required this.total,
    required this.onMore,
  });

  final bool loading;
  final String? problem;

  /// Entries the Mac holds that the sheet does not show.
  final int left;
  final bool more;
  final int shown;
  final int total;
  final VoidCallback onMore;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    if (loading) return _Reading(theme: theme);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Spacing.lg,
        Spacing.sm,
        Spacing.lg,
        Spacing.xl,
      ),
      child: Column(
        children: [
          if (problem case final text?)
            Padding(
              padding: Insets.bottomSm,
              child: Text(
                text,
                textAlign: TextAlign.center,
                style: AppTypography.bodySmall(color: theme.error),
              ),
            ),
          if (more)
            _ReadEarlier(left: left, onTap: onMore, theme: theme)
          else if (left > 0)
            Text(
              'Showing the newest $shown of $total entries. '
              'Open the session in a terminal to see the rest.',
              key: const ValueKey('tree-capped'),
              textAlign: TextAlign.center,
              style: AppTypography.caption(color: theme.textMuted),
            ),
        ],
      ),
    );
  }
}

class _Reading extends StatelessWidget {
  const _Reading({required this.theme});

  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Padding(
    padding: Insets.screen,
    child: Center(
      child: SizedBox.square(
        dimension: 16,
        child: CircularProgressIndicator(
          strokeWidth: 1.5,
          valueColor: AlwaysStoppedAnimation(theme.primary),
        ),
      ),
    ),
  );
}

class _ReadEarlier extends StatelessWidget {
  const _ReadEarlier({
    required this.left,
    required this.onTap,
    required this.theme,
  });

  final int left;
  final VoidCallback onTap;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => GestureDetector(
    key: const ValueKey('tree-more'),
    onTap: onTap,
    behavior: HitTestBehavior.opaque,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(AppIcons.unfoldMore, size: 14, color: theme.textMuted),
          const SizedBox(width: 6),
          Text(
            'Load earlier entries ($left more)',
            style: AppTypography.label(color: theme.text),
          ),
        ],
      ),
    ),
  );
}
