import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/screens/sessions/subagent_tasks_view.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The old Claude Code's Tasks tab: the subagent sessions of the active
/// backend, with a way back to its sessions.
class TasksTabWrapper extends ConsumerWidget {
  const TasksTabWrapper({super.key, required this.onBack});
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final backend = ref.watch(agentTypeProvider);
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      GestureDetector(
                        onTap: onBack,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              AppIcons.chevronLeft,
                              size: 20,
                              color: ocTheme.primary,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              'Sessions',
                              style: TextStyle(
                                color: ocTheme.primary,
                                fontSize: 15,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: Spacing.md),
                  Text(
                    'Tasks',
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 32,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: Spacing.xs),
                  Text(
                    'Subagent sessions from ${backend.displayName}',
                    style: TextStyle(
                      color: ocTheme.textMuted,
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
            const Expanded(child: SubagentTasksView()),
          ],
        ),
      ),
    );
  }
}
