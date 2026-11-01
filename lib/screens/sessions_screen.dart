import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/screens/sessions/cc_sessions_view.dart';
import 'package:broski/screens/sessions/contract_sessions_tab.dart';
import 'package:broski/screens/sessions/subagent_tasks_view.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class SessionsScreen extends ConsumerWidget {
  const SessionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(selectedBackendProvider) case ContractSelection(:final id)) {
      return ContractSessionsTab(backend: id);
    }
    if (ref.watch(showTasksTabProvider)) {
      return _TasksTabWrapper(
        onBack: () => ref.read(showTasksTabProvider.notifier).state = false,
      );
    }
    return const ClaudeCodeSessionsView();
  }
}

/// Wrapper for the Tasks tab that shows subagent sessions for the active backend.
class _TasksTabWrapper extends ConsumerWidget {
  const _TasksTabWrapper({required this.onBack});
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
