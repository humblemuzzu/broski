import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One harness activity, such as a hook, as a compact line: what ran, on
/// which occasion, how it ended and how long it took. Its output stays folded
/// until the line is tapped.
class ActivityCard extends StatefulWidget {
  const ActivityCard({super.key, required this.item});

  final ActivityItem item;

  @override
  State<ActivityCard> createState() => _ActivityCardState();
}

class _ActivityCardState extends State<ActivityCard> {
  var _open = false;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final item = widget.item;
    final output = item.output?.trim() ?? '';
    final folds = output.isNotEmpty;
    return Padding(
      padding: Insets.bottomSm,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            key: ValueKey('activity-row:${item.id}'),
            onTap: folds ? () => setState(() => _open = !_open) : null,
            child: Row(
              children: [
                _StatusMark(status: item.status),
                const SizedBox(width: Spacing.sm),
                Expanded(
                  child: Text(
                    activitySummary(item),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTypography.caption(color: theme.textMuted),
                  ),
                ),
                if (folds)
                  Icon(
                    _open ? Icons.expand_less : Icons.expand_more,
                    size: 16,
                    color: theme.textMuted,
                  ),
              ],
            ),
          ),
          if (_open)
            Container(
              key: ValueKey('activity-output:${item.id}'),
              margin: Insets.topSm,
              padding: Insets.cardSm,
              decoration: BoxDecoration(
                color: theme.backgroundElement,
                borderRadius: Radii.brSm,
              ),
              child: SelectableText(output, style: AppTypography.codeSmall()),
            ),
        ],
      ),
    );
  }
}

/// The line an activity reads as: `label · occasion · outcome · duration`.
String activitySummary(ActivityItem item) => [
  item.label,
  ?item.detail,
  _statusWord(item.status),
  if (item.durationMs case final ms?) durationText(ms),
].join(' · ');

String durationText(int ms) =>
    ms < 1000 ? '$ms ms' : '${(ms / 1000).toStringAsFixed(1)} s';

String _statusWord(ActivityStatus status) => switch (status) {
  ActivityStatus.running => 'running',
  ActivityStatus.succeeded => 'done',
  ActivityStatus.failed => 'failed',
  ActivityStatus.cancelled => 'cancelled',
};

class _StatusMark extends StatelessWidget {
  const _StatusMark({required this.status});

  final ActivityStatus status;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    if (status == ActivityStatus.running) {
      return SizedBox(
        width: 12,
        height: 12,
        child: CircularProgressIndicator(
          strokeWidth: 1.5,
          color: theme.info,
          semanticsLabel: 'Running',
        ),
      );
    }
    final (icon, color) = switch (status) {
      ActivityStatus.succeeded => (Icons.check_circle_outline, theme.success),
      ActivityStatus.failed => (Icons.error_outline, theme.error),
      _ => (Icons.cancel_outlined, theme.textMuted),
    };
    return Icon(icon, size: 14, color: color);
  }
}
