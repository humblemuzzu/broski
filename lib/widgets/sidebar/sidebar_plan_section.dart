import 'package:broski/models/todo.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sidebar/sidebar_divided_list.dart';
import 'package:broski/widgets/sidebar/sidebar_notice.dart';
import 'package:broski/widgets/sidebar/sidebar_section.dart';
import 'package:broski/widgets/sidebar/sidebar_todo_item.dart';
import 'package:flutter/material.dart';

/// The session's plan: every todo and how many of them are done.
class PlanSection extends StatelessWidget {
  const PlanSection({super.key, required this.todos});

  final List<Todo> todos;

  @override
  Widget build(BuildContext context) {
    if (todos.isEmpty) {
      return const SidebarSection(
        title: 'Plan',
        icon: AppIcons.checklist,
        children: [
          SidebarNotice(icon: AppIcons.info, message: 'No active plan'),
        ],
      );
    }
    final completed = todos
        .where((todo) => todo.status == TodoStatus.completed)
        .length;
    return SidebarSection(
      title: 'Plan',
      icon: AppIcons.checklist,
      trailing: _DoneCount(completed: completed, total: todos.length),
      children: [
        SidebarDividedList(
          items: [for (final todo in todos) SidebarTodoItem(todo: todo)],
        ),
      ],
    );
  }
}

class _DoneCount extends StatelessWidget {
  const _DoneCount({required this.completed, required this.total});

  final int completed;
  final int total;

  @override
  Widget build(BuildContext context) {
    return Text(
      '$completed/$total done',
      style: TextStyle(
        fontSize: 12,
        color: OpenCodeTheme.of(context).textMuted,
        fontWeight: FontWeight.w500,
      ),
    );
  }
}
