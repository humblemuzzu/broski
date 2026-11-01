import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/screens/sessions/cc_sessions_view.dart';
import 'package:broski/screens/sessions/contract_sessions_tab.dart';
import 'package:broski/screens/sessions/tasks_tab_wrapper.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The Sessions tab of the chosen backend. Nothing is built before the stored
/// choice is read, so a contract backend's tab never asks the old protocol.
class SessionsScreen extends ConsumerWidget {
  const SessionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(selectedBackendReadyProvider).isLoading) {
      return const SizedBox.shrink();
    }
    if (ref.watch(selectedBackendProvider) case ContractSelection(:final id)) {
      return ContractSessionsTab(backend: id);
    }
    if (ref.watch(showTasksTabProvider)) {
      return TasksTabWrapper(
        onBack: () => ref.read(showTasksTabProvider.notifier).state = false,
      );
    }
    return const ClaudeCodeSessionsView();
  }
}
