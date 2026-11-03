import 'package:broski/models/todo.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One todo of the plan section: its status icon, the text and its state.
class SidebarTodoItem extends StatelessWidget {
  const SidebarTodoItem({super.key, required this.todo});

  final Todo todo;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final (icon, color) = switch (todo.status) {
      TodoStatus.pending => (AppIcons.radioUnchecked, theme.textMuted),
      TodoStatus.inProgress => (AppIcons.play, theme.info),
      TodoStatus.completed => (AppIcons.checkCircle, theme.success),
      TodoStatus.cancelled => (AppIcons.cancel, theme.error),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _TodoText(todo: todo),
                const SizedBox(height: Spacing.xs),
                _TodoState(todo: todo),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TodoText extends StatelessWidget {
  const _TodoText({required this.todo});

  final Todo todo;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final isCompleted = todo.status == TodoStatus.completed;
    final isCancelled = todo.status == TodoStatus.cancelled;
    return Text(
      todo.content,
      style: TextStyle(
        fontSize: 13,
        color: (isCompleted || isCancelled) ? theme.textMuted : theme.text,
        fontWeight: todo.status == TodoStatus.inProgress
            ? FontWeight.w600
            : FontWeight.w400,
        decoration: isCancelled ? TextDecoration.lineThrough : null,
      ),
      maxLines: 3,
      overflow: TextOverflow.ellipsis,
    );
  }
}

class _TodoState extends StatelessWidget {
  const _TodoState({required this.todo});

  final Todo todo;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      children: [
        if (todo.priority == TodoPriority.high) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: theme.error.withValues(alpha: 0.15),
              borderRadius: Radii.brXs,
            ),
            child: Text(
              'HIGH',
              style: TextStyle(
                fontSize: 9,
                fontWeight: FontWeight.w600,
                color: theme.error,
                letterSpacing: 0.5,
              ),
            ),
          ),
          const SizedBox(width: 6),
        ],
        Text(
          todo.status.displayName,
          style: AppTypography.caption(color: theme.textMuted),
        ),
      ],
    );
  }
}
