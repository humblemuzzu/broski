import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The agent's todo list (`plan_updated`), folded to its progress until opened.
class PlanCard extends StatefulWidget {
  const PlanCard({super.key, required this.plan});

  final Plan plan;

  @override
  State<PlanCard> createState() => _PlanCardState();
}

class _PlanCardState extends State<PlanCard> {
  var _open = false;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final items = widget.plan.items;
    final done = items
        .where((item) => item.status == PlanItemStatus.completed)
        .length;
    return InkWell(
      key: const ValueKey('plan-card'),
      onTap: () => setState(() => _open = !_open),
      child: Padding(
        padding: Insets.cardSm,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Plan · $done of ${items.length} done',
              style: AppTypography.label(color: theme.primary),
            ),
            if (_open) ...[
              if (widget.plan.explanation case final why?)
                Text(why, style: AppTypography.bodySmall()),
              for (final item in items)
                Row(
                  children: [
                    Icon(_icon(item.status), size: 14, color: theme.textMuted),
                    const SizedBox(width: Spacing.sm),
                    Expanded(
                      child: Text(item.text, style: AppTypography.bodySmall()),
                    ),
                  ],
                ),
            ],
          ],
        ),
      ),
    );
  }
}

IconData _icon(PlanItemStatus status) => switch (status) {
  PlanItemStatus.pending => AppIcons.pending,
  PlanItemStatus.inProgress => AppIcons.hourglass,
  PlanItemStatus.completed => AppIcons.checkCircle,
  PlanItemStatus.cancelled => AppIcons.cancel,
};
