import 'package:broski/agent/ui/chat/turn_markers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A retry or a compaction under way, or how the last run ended when that
/// needs saying (it failed, hit a limit, was suspended or deferred). A line
/// that can be cancelled on its own carries the button for it: [onCancelRetry]
/// and [onCancelCompaction] are null where the session cannot.
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
          'Retrying (attempt ${retry.attempt}'
          '${retry.maxAttempts == null ? '' : ' of ${retry.maxAttempts}'}): '
          '${retry.message}',
          theme.warning,
          cancel: onCancelRetry,
          cancelKey: 'cancel-retry',
          cancelLabel: 'Cancel retry',
        ),
      if (compaction != null)
        _BannerLine(
          'Compacting the context (${compaction.trigger.wire})',
          theme.info,
          cancel: onCancelCompaction,
          cancelKey: 'cancel-compaction',
          cancelLabel: 'Cancel compaction',
        ),
      if (outcome != null && outcome is! RunCompleted && outcome is! RunAborted)
        _BannerLine(
          outcomeText(outcome),
          outcome is RunErrored ? theme.error : theme.info,
        ),
    ];
    if (lines.isEmpty) return const SizedBox.shrink();
    return Container(
      key: const ValueKey('run-banner'),
      width: double.infinity,
      padding: Insets.cardSm,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: lines,
      ),
    );
  }
}

class _BannerLine extends StatelessWidget {
  const _BannerLine(
    this.text,
    this.color, {
    this.cancel,
    this.cancelKey = '',
    this.cancelLabel = 'Cancel',
  });

  final String text;
  final Color color;
  final VoidCallback? cancel;
  final String cancelKey;
  final String cancelLabel;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(text, style: AppTypography.bodySmall(color: color)),
      ),
      if (cancel != null)
        TextButton(
          key: ValueKey(cancelKey),
          onPressed: cancel,
          child: Text(cancelLabel),
        ),
    ],
  );
}
