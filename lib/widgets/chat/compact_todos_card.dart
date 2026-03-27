import 'package:flutter/material.dart';
import '../../theme/app_typography.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/card_style.dart';
import '../../models/todo.dart';
import '../../providers/card_style_provider.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'detail_sheet.dart';
import 'package:broski/theme/app_icons.dart';

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
          borderRadius: Radii.brMd,
          border: Border.all(color: borderColor),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row with distinct background
            Container(
              padding: Insets.card,
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
                      Icon(AppIcons.checklist, size: 16, color: theme.toolTodo),
                      SizedBox(width: 6),
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
                    padding: Insets.chip,
                    decoration: BoxDecoration(
                      color: theme.info.withValues(alpha: 0.15),
                      borderRadius: Radii.brSm,
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
            // Progress bar
            Padding(
              padding: EdgeInsets.fromLTRB(
                Spacing.md,
                Spacing.sm,
                Spacing.md,
                0,
              ),
              child: ClipRRect(
                borderRadius: Radii.brNone,
                child: LinearProgressIndicator(
                  value: todos.isEmpty ? 0 : completed / todos.length,
                  minHeight: 3,
                  backgroundColor: theme.borderSubtle.withValues(alpha: 0.3),
                  valueColor: AlwaysStoppedAnimation(
                    completed == todos.length ? theme.success : theme.info,
                  ),
                ),
              ),
            ),
            // Todo items
            Padding(
              padding: Insets.cardH,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ...displayTodos.map((todo) => _buildTodoRow(todo, theme)),
                  // "And N more" if truncated
                  if (todos.length > 5)
                    Padding(
                      padding: EdgeInsets.only(top: Spacing.xs),
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
            SizedBox(height: Spacing.sm),
          ],
        ),
      ),
    );
  }

  Widget _buildTodoRow(Todo todo, OpenCodeTheme theme) {
    final (icon, color) = _getStatusIconAndColor(todo.status, theme);
    return Padding(
      padding: Insets.chipV,
      child: Row(
        children: [
          Icon(icon, size: 16, color: color),
          SizedBox(width: Spacing.sm),
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
        return (AppIcons.checkBox, theme.success);
      case TodoStatus.inProgress:
        return (AppIcons.radioChecked, theme.info);
      case TodoStatus.cancelled:
        return (AppIcons.cancel, theme.textMuted);
      case TodoStatus.pending:
        return (AppIcons.checkBoxBlank, theme.textMuted);
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
        style: AppTypography.labelLarge(color: theme.textMuted),
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
      padding: Insets.listItem,
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
            padding: EdgeInsets.only(top: Spacing.xxs),
            child: Icon(icon, size: 18, color: color),
          ),
          SizedBox(width: Spacing.md),
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
                    padding: EdgeInsets.only(top: Spacing.xs),
                    child: Container(
                      padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: theme.error.withValues(alpha: 0.15),
                        borderRadius: Radii.brXs,
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
        return (AppIcons.checkBox, theme.success);
      case TodoStatus.inProgress:
        return (AppIcons.radioChecked, theme.info);
      case TodoStatus.cancelled:
        return (AppIcons.cancel, theme.textMuted);
      case TodoStatus.pending:
        return (AppIcons.checkBoxBlank, theme.textMuted);
    }
  }
}
