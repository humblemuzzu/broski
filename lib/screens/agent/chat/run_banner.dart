import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/turn_markers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A retry or a compaction under way, or how the last run ended when that
/// needs saying (it failed, hit a limit, was suspended or deferred), each in
/// the chat's retry-banner style. A line that can be cancelled on its own
/// carries the button for it: [onCancelRetry] and [onCancelCompaction] are
/// null where the session cannot.
class RunBanner extends StatelessWidget {
  const RunBanner({
    super.key,
    required this.snapshot,
    this.onCancelRetry,
    this.onCancelCompaction,
  });

  final SessionSnapshot snapshot;
  final VoidCallback? onCancelRetry;
  final VoidCallback? onCancelCompaction;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final retry = snapshot.retry;
    final compaction = snapshot.compaction;
    final outcome = snapshot.run == null ? snapshot.lastOutcome : null;
    final lines = [
      if (retry != null)
        _BannerLine(
          icon: AppIcons.refresh,
          text:
              'Retrying (attempt ${retry.attempt}'
              '${retry.maxAttempts == null ? '' : ' of ${retry.maxAttempts}'}): '
              '${retry.message}',
          color: theme.warning,
          cancel: onCancelRetry,
          cancelKey: 'cancel-retry',
          cancelLabel: 'Cancel retry',
        ),
      if (compaction != null)
        _BannerLine(
          icon: AppIcons.compress,
          text: 'Compacting the context (${compaction.trigger.wire})',
          color: theme.info,
          cancel: onCancelCompaction,
          cancelKey: 'cancel-compaction',
          cancelLabel: 'Cancel compaction',
        ),
      if (outcome != null && outcome is! RunCompleted && outcome is! RunAborted)
        _BannerLine(
          icon: outcome is RunErrored ? AppIcons.error : AppIcons.info,
          text: outcomeText(outcome),
          color: outcome is RunErrored ? theme.error : theme.info,
        ),
    ];
    if (lines.isEmpty) return const SizedBox.shrink();
    return Padding(
      key: const ValueKey('run-banner'),
      padding: const EdgeInsets.fromLTRB(16, 0, 16, Spacing.sm),
      child: Column(mainAxisSize: MainAxisSize.min, children: lines),
    );
  }
}

class _BannerLine extends StatelessWidget {
  const _BannerLine({
    required this.icon,
    required this.text,
    required this.color,
    this.cancel,
    this.cancelKey = '',
    this.cancelLabel = 'Cancel',
  });

  final IconData icon;
  final String text;
  final Color color;
  final VoidCallback? cancel;
  final String cancelKey;
  final String cancelLabel;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.only(top: Spacing.xs),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: Radii.brMd,
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: theme.text,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (cancel case final onCancel?)
            GestureDetector(
              key: ValueKey(cancelKey),
              onTap: onCancel,
              child: Padding(
                padding: const EdgeInsets.only(left: Spacing.sm),
                child: Text(
                  cancelLabel,
                  style: TextStyle(
                    color: color,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
