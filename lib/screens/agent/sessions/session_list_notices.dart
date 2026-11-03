import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// What a list says when it has no row to show.
class SessionListEmptyState extends StatelessWidget {
  const SessionListEmptyState({
    super.key,
    required this.title,
    required this.detail,
  });

  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 48, 20, 48),
      child: Column(
        children: [
          Container(
            padding: Insets.cardLg,
            decoration: BoxDecoration(
              color: theme.primary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(AppIcons.history, size: 48, color: theme.primary),
          ),
          const SizedBox(height: Spacing.xxl),
          Text(
            title,
            style: TextStyle(
              color: theme.text,
              fontSize: 20,
              fontWeight: FontWeight.w600,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: Spacing.sm),
          Text(
            detail,
            style: TextStyle(color: theme.textMuted, fontSize: 14),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

/// The button that asks for the next page of a list the bridge has more of.
class SessionListLoadMore extends StatelessWidget {
  const SessionListLoadMore({
    super.key,
    required this.loading,
    required this.onTap,
  });

  final bool loading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.bottomMd,
      child: InkWell(
        onTap: loading ? null : onTap,
        borderRadius: Radii.brMd,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
          decoration: BoxDecoration(
            color: theme.backgroundElement.withValues(alpha: 0.5),
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(AppIcons.expandMore, size: 16, color: theme.primary),
              const SizedBox(width: 6),
              Text(
                loading ? 'Loading\u2026' : 'Show more sessions',
                style: TextStyle(
                  color: theme.primary,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A line under the list saying what it left out, or how far it has looked.
class SessionListNote extends StatelessWidget {
  const SessionListNote({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
    child: Text(
      text,
      style: AppTypography.caption(color: OpenCodeTheme.of(context).textMuted),
    ),
  );
}

/// What a list shows when the bridge answered with something other than rows.
class SessionListProblem extends StatelessWidget {
  const SessionListProblem({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.error.withValues(alpha: 0.1),
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(AppIcons.error, size: 16, color: theme.error),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Text(
              text,
              style: AppTypography.bodySmall(color: theme.error),
            ),
          ),
        ],
      ),
    );
  }
}
