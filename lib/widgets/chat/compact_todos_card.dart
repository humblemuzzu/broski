import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/card_style.dart';
import '../../models/todo.dart';
import '../../providers/card_style_provider.dart';
import '../../theme/opencode_theme.dart';
import 'detail_sheet.dart';

/// An inline card showing the current todo list.
/// Displayed in chat flow when todos are updated via TodoWrite.
/// Tapping opens full todo list in a sheet.
class CompactTodosCard extends ConsumerWidget {
  final List<Todo> todos;
  final VoidCallback? onTap;

  const CompactTodosCard({super.key, required this.todos, this.onTap});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final cardStyle = ref.watch(cardStyleProvider);
    final completed = todos
        .where((t) => t.status == TodoStatus.completed)
        .length;
    final displayTodos = todos.take(5).toList();

    // Determine colors based on card style settings
    final Color headerBg;
    final Color borderColor;
    final toolColor = theme.toolTodo;

    switch (cardStyle.headerStyle) {
      case CardHeaderStyle.solid:
        headerBg = theme.cardHeaderBg;
      case CardHeaderStyle.tinted:
        headerBg = toolColor.withValues(alpha: 0.1);
      case CardHeaderStyle.minimal:
        headerBg = Colors.transparent;
    }

    switch (cardStyle.borderVisibility) {
      case CardBorderVisibility.subtle:
        borderColor = theme.cardBorderSubtle;
      case CardBorderVisibility.visible:
        borderColor = theme.cardHeaderBorder;
      case CardBorderVisibility.accent:
        borderColor = toolColor.withValues(alpha: 0.5);
    }

    return GestureDetector(
      onTap: () {
        if (onTap != null) {
          onTap!();
        } else {
          _showDetailSheet(context);
        }
      },
      child: Container(
        decoration: BoxDecoration(
          color: theme.bgRaised,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: borderColor),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row with distinct background
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: headerBg,
                border: Border(
                  bottom: BorderSide(color: borderColor, width: 1),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.checklist_rounded,
                        size: 16,
                        color: theme.toolTodo,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'Update Todos',
                        style: TextStyle(
                          color: theme.cardHeaderText,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                  // Progress badge
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: theme.info.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '$completed/${todos.length} done',
                      style: TextStyle(
                        color: theme.info,
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Todo items
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ...displayTodos.map((todo) => _buildTodoRow(todo, theme)),

                  // "And N more" if truncated
                  if (todos.length > 5)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        '... and ${todos.length - 5} more',
                        style: TextStyle(
                          color: theme.textMuted,
                          fontSize: 11,
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Widget _buildTodoRow(Todo todo, OpenCodeTheme theme) {
    final (icon, color) = _getStatusIconAndColor(todo.status, theme);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              todo.content,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: todo.status == TodoStatus.completed
                    ? theme.textMuted
                    : theme.text,
                fontSize: 12,
                decoration: todo.status == TodoStatus.completed
                    ? TextDecoration.lineThrough
                    : null,
              ),
            ),
          ),
        ],
      ),
    );
  }

  (IconData, Color) _getStatusIconAndColor(
    TodoStatus status,
    OpenCodeTheme theme,
  ) {
    switch (status) {
      case TodoStatus.completed:
        return (Icons.check_box, theme.success);
      case TodoStatus.inProgress:
        return (Icons.radio_button_checked, theme.info);
      case TodoStatus.cancelled:
        return (Icons.disabled_by_default_outlined, theme.textMuted);
      case TodoStatus.pending:
        return (Icons.check_box_outline_blank, theme.textMuted);
    }
  }

  void _showDetailSheet(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final completed = todos
        .where((t) => t.status == TodoStatus.completed)
        .length;

    DetailSheet.show(
      context: context,
      title: 'Todos',
      trailing: Text(
        '$completed/${todos.length}',
        style: TextStyle(color: theme.textMuted, fontSize: 14),
      ),
      child: ListView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: todos.length,
        itemBuilder: (context, index) => _TodoDetailItem(todo: todos[index]),
      ),
    );
  }
}

/// Detailed todo item for the sheet view
class _TodoDetailItem extends StatelessWidget {
  final Todo todo;

  const _TodoDetailItem({required this.todo});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final (icon, color) = _getStatusIconAndColor(todo.status, theme);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: theme.borderSubtle.withValues(alpha: 0.3)),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Status icon
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(icon, size: 18, color: color),
          ),
          const SizedBox(width: 12),

          // Content and priority
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Todo content
                Text(
                  todo.content,
                  style: TextStyle(
                    color: todo.status == TodoStatus.completed
                        ? theme.textMuted
                        : theme.text,
                    fontSize: 14,
                    decoration: todo.status == TodoStatus.completed
                        ? TextDecoration.lineThrough
                        : null,
                  ),
                ),

                // Priority badge (if high)
                if (todo.priority == TodoPriority.high)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: theme.error.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        'HIGH',
                        style: TextStyle(
                          color: theme.error,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  (IconData, Color) _getStatusIconAndColor(
    TodoStatus status,
    OpenCodeTheme theme,
  ) {
    switch (status) {
      case TodoStatus.completed:
        return (Icons.check_box, theme.success);
      case TodoStatus.inProgress:
        return (Icons.radio_button_checked, theme.info);
      case TodoStatus.cancelled:
        return (Icons.disabled_by_default_outlined, theme.textMuted);
      case TodoStatus.pending:
        return (Icons.check_box_outline_blank, theme.textMuted);
    }
  }
}
