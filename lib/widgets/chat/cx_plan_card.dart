import 'package:broski/models/todo.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Compact inline plan card shown in the Codex chat stream when the agent
/// updates its structured plan. Shows a progress bar and checklist items.
///
/// This is distinct from `CompactTodosCard` which is for OpenCode's TodoWrite.
/// This card is styled for Codex plan mode and shows step-by-step progress
/// with color-coded status indicators.
class CxPlanCard extends StatefulWidget {
  const CxPlanCard({super.key, required this.todos, this.explanation});

  /// Plan items from `turn/plan/updated` event.
  final List<Todo> todos;

  /// Optional plan explanation text.
  final String? explanation;

  @override
  State<CxPlanCard> createState() => _CxPlanCardState();
}

class _CxPlanCardState extends State<CxPlanCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final todos = widget.todos;
    if (todos.isEmpty) return const SizedBox.shrink();

    final completed = todos
        .where((t) => t.status == TodoStatus.completed)
        .length;
    final inProgress = todos
        .where((t) => t.status == TodoStatus.inProgress)
        .length;
    final total = todos.length;
    final progress = total > 0 ? completed / total : 0.0;

    final progressColor = completed == total
        ? theme.success
        : inProgress > 0
        ? theme.primary
        : theme.textMuted;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header
          GestureDetector(
            onTap: () => setState(() => _expanded = !_expanded),
            behavior: HitTestBehavior.opaque,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  Icon(AppIcons.checklist, size: 14, color: theme.primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Plan',
                      style: AppTypography.bodySmall(
                        color: theme.text,
                      ).copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  // Progress badge
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: progressColor.withValues(alpha: 0.15),
                      borderRadius: Radii.brFull,
                    ),
                    child: Text(
                      '$completed/$total',
                      style: AppTypography.label(
                        color: progressColor,
                      ).copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Icon(
                    _expanded ? AppIcons.chevronUp : AppIcons.chevronDown,
                    size: 14,
                    color: theme.textMuted,
                  ),
                ],
              ),
            ),
          ),
          // Progress bar
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: ClipRRect(
              borderRadius: Radii.brFull,
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 3,
                backgroundColor: theme.border,
                valueColor: AlwaysStoppedAnimation<Color>(progressColor),
              ),
            ),
          ),
          // Explanation
          if (widget.explanation != null && widget.explanation!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Text(
                widget.explanation!,
                style: AppTypography.label(color: theme.textMuted),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          // Items (collapsible)
          if (_expanded) ...[
            const SizedBox(height: 6),
            ...todos
                .take(10)
                .map((todo) => _PlanItem(todo: todo, theme: theme)),
            if (todos.length > 10)
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 4,
                ),
                child: Text(
                  '…and ${todos.length - 10} more',
                  style: AppTypography.label(color: theme.textMuted),
                ),
              ),
          ],
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _PlanItem extends StatelessWidget {
  const _PlanItem({required this.todo, required this.theme});
  final Todo todo;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    final icon = switch (todo.status) {
      TodoStatus.completed => Icon(
        AppIcons.check,
        size: 14,
        color: theme.success,
      ),
      TodoStatus.inProgress => SizedBox(
        width: 14,
        height: 14,
        child: CircularProgressIndicator(
          strokeWidth: 1.5,
          color: theme.primary,
        ),
      ),
      TodoStatus.cancelled => Icon(
        AppIcons.close,
        size: 14,
        color: theme.error,
      ),
      TodoStatus.pending => Icon(
        AppIcons.circleOutlined,
        size: 14,
        color: theme.textMuted,
      ),
    };

    final textColor = switch (todo.status) {
      TodoStatus.completed => theme.textMuted,
      TodoStatus.inProgress => theme.text,
      TodoStatus.cancelled => theme.textMuted,
      TodoStatus.pending => theme.text,
    };

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(padding: const EdgeInsets.only(top: 1), child: icon),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              todo.content,
              style: AppTypography.bodySmall(color: textColor).copyWith(
                decoration: todo.status == TodoStatus.completed
                    ? TextDecoration.lineThrough
                    : null,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
