import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:flutter/material.dart';

/// What one backend's list shows when that backend failed: the reason and a retry for it alone.
///
/// Every backend's list loads on its own, so a failure here never stands in for another backend's
/// list and never hides the project picker.
class SessionListErrorCard extends StatelessWidget {
  const SessionListErrorCard({
    super.key,
    required this.title,
    required this.error,
    required this.onRetry,
  });

  final String title;
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 32, 20, 32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(AppIcons.error, color: ocTheme.error, size: 40),
          const SizedBox(height: Spacing.md),
          Text(
            title,
            style: TextStyle(
              color: ocTheme.text,
              fontSize: 16,
              fontWeight: FontWeight.w600,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: Spacing.sm),
          Text(
            humanizeError(error),
            style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: Spacing.lg),
          TextButton.icon(
            onPressed: onRetry,
            icon: Icon(AppIcons.refresh, size: 16, color: ocTheme.primary),
            label: Text(
              'Retry',
              style: TextStyle(color: ocTheme.primary, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}

/// The end of a paged list: a spinner for the next page, or a retry when that page failed.
class SessionListFooter extends StatelessWidget {
  const SessionListFooter({
    super.key,
    required this.hasMore,
    required this.isLoading,
    required this.failed,
    required this.onRetry,
  });

  final bool hasMore;
  final bool isLoading;
  final bool failed;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    if (isLoading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    if (failed) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: TextButton.icon(
            onPressed: onRetry,
            icon: Icon(AppIcons.refresh, size: 16, color: ocTheme.primary),
            label: Text(
              'Load more',
              style: TextStyle(color: ocTheme.primary, fontSize: 13),
            ),
          ),
        ),
      );
    }
    return SizedBox(height: hasMore ? 8 : 16);
  }
}

/// Asks for the next page once the list is near its end, so scrolling never runs out of rows.
class SessionListScrollTrigger extends StatelessWidget {
  const SessionListScrollTrigger({
    super.key,
    required this.onNearBottom,
    required this.child,
    this.threshold = 480,
  });

  final VoidCallback onNearBottom;
  final Widget child;
  final double threshold;

  @override
  Widget build(BuildContext context) {
    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (notification.metrics.axis == Axis.vertical &&
            notification.metrics.extentAfter <= threshold) {
          onNearBottom();
        }
        return false;
      },
      child: child,
    );
  }
}
