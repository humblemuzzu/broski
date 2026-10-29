import 'package:broski/agent/ui/chat/turn_markers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A retry or a compaction under way, or how the last run ended when that
/// needs saying (it failed, hit a limit, was suspended or deferred).
class RunBanner extends StatelessWidget {
  const RunBanner({super.key, required this.snapshot});

  final SessionSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final retry = snapshot.retry;
    final compaction = snapshot.compaction;
    final outcome = snapshot.run == null ? snapshot.lastOutcome : null;
    final lines = [
      if (retry != null)
        (
          'Retrying (attempt ${retry.attempt}'
              '${retry.maxAttempts == null ? '' : ' of ${retry.maxAttempts}'}): '
              '${retry.message}',
          theme.warning,
        ),
      if (compaction != null)
        ('Compacting the context (${compaction.trigger.wire})', theme.info),
      if (outcome != null && outcome is! RunCompleted && outcome is! RunAborted)
        (
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
        children: [
          for (final (text, color) in lines)
            Text(text, style: AppTypography.bodySmall(color: color)),
        ],
      ),
    );
  }
}
