import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One harness activity, such as a hook, in the chat's compact hook-card
/// style: what ran, on which occasion, how it ended and how long it took.
/// Its output stays folded until the card is tapped.
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
    final color = _statusColor(item.status, theme);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 2),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: Radii.brSm,
        border: Border.all(color: color.withValues(alpha: 0.2), width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GestureDetector(
            key: ValueKey('activity-row:${item.id}'),
            behavior: HitTestBehavior.opaque,
            onTap: folds ? () => setState(() => _open = !_open) : null,
            child: _Line(item: item, color: color, folds: folds, open: _open),
          ),
          if (_open)
            Container(
              key: ValueKey('activity-output:${item.id}'),
              margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
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

class _Line extends StatelessWidget {
  const _Line({
    required this.item,
    required this.color,
    required this.folds,
    required this.open,
  });

  final ActivityItem item;
  final Color color;
  final bool folds;
  final bool open;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          _StatusMark(status: item.status, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              activitySummary(item),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11, color: theme.textMuted),
            ),
          ),
          if (folds)
            Icon(
              open ? AppIcons.expandLess : AppIcons.expandMore,
              size: 14,
              color: theme.textMuted,
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

Color _statusColor(ActivityStatus status, OpenCodeTheme theme) =>
    switch (status) {
      ActivityStatus.running => theme.accent,
      ActivityStatus.succeeded => theme.success,
      ActivityStatus.failed => theme.error,
      ActivityStatus.cancelled => theme.textMuted,
    };

class _StatusMark extends StatelessWidget {
  const _StatusMark({required this.status, required this.color});

  final ActivityStatus status;
  final Color color;

  @override
  Widget build(BuildContext context) {
    if (status == ActivityStatus.running) {
      return SizedBox(
        width: 12,
        height: 12,
        child: CircularProgressIndicator(
          strokeWidth: 1.5,
          color: color,
          semanticsLabel: 'Running',
        ),
      );
    }
    final icon = switch (status) {
      ActivityStatus.succeeded => AppIcons.checkCircle,
      ActivityStatus.failed => AppIcons.error,
      _ => AppIcons.cancel,
    };
    return Icon(icon, size: 14, color: color);
  }
}
