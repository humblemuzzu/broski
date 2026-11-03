import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/todo.dart';
import 'package:broski/widgets/chat/compact_todos_card.dart';
import 'package:flutter/material.dart';

/// The agent's todo list (`plan_updated`) as the chat's todos card; a tap
/// opens the sidebar, where the whole plan is.
class PlanCard extends StatelessWidget {
  const PlanCard({super.key, required this.plan, this.onTap});

  final Plan plan;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Padding(
    key: const ValueKey('plan-card'),
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
    child: CompactTodosCard(todos: todosOf(plan), onTap: onTap),
  );
}

/// [plan]'s items as the app's todos, in order.
List<Todo> todosOf(Plan? plan) => [
  for (final (index, item) in (plan?.items ?? const <PlanItem>[]).indexed)
    Todo(
      id: '$index',
      content: item.text,
      status: switch (item.status) {
        PlanItemStatus.pending => TodoStatus.pending,
        PlanItemStatus.inProgress => TodoStatus.inProgress,
        PlanItemStatus.completed => TodoStatus.completed,
        PlanItemStatus.cancelled => TodoStatus.cancelled,
      },
      priority: TodoPriority.medium,
    ),
];
