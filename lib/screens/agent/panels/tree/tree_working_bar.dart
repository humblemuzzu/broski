import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// What the tree is doing to the session while it does it, with the way to
/// stop a summary halfway.
class TreeWorkingBar extends StatelessWidget {
  const TreeWorkingBar({super.key, required this.label, this.onCancel});

  final String label;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      key: const ValueKey('tree-working'),
      margin: const EdgeInsets.symmetric(
        horizontal: Spacing.md,
        vertical: Spacing.xs,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.md,
        vertical: Spacing.sm,
      ),
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Row(
        children: [
          SizedBox.square(
            dimension: 12,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              valueColor: AlwaysStoppedAnimation(theme.primary),
            ),
          ),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Text(
              label,
              style: AppTypography.label(color: theme.primary),
            ),
          ),
          if (onCancel case final cancel?) _CancelAction(onTap: cancel),
        ],
      ),
    );
  }
}

class _CancelAction extends StatelessWidget {
  const _CancelAction({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return GestureDetector(
      key: const ValueKey('tree-cancel-summary'),
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: theme.error.withValues(alpha: 0.12),
          borderRadius: Radii.brSm,
        ),
        child: Text('Cancel', style: AppTypography.label(color: theme.error)),
      ),
    );
  }
}
