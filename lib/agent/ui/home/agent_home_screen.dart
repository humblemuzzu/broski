import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/ui/backend_label.dart';
import 'package:broski/agent/ui/sessions/session_list_screen.dart';
import 'package:broski/agent/ui/shared/status_look.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The contract core's front page: the connection, then every backend the
/// bridge serves with how it is.
class AgentHomeScreen extends ConsumerWidget {
  const AgentHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final backends = ref.watch(backendsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Agent core'),
        actions: [
          IconButton(
            tooltip: 'List again',
            icon: const Icon(AppIcons.refresh),
            onPressed: () => ref.read(backendsProvider.notifier).refresh(),
          ),
        ],
      ),
      body: ListView(
        padding: Insets.screen,
        children: [
          const _ConnectionRow(),
          if (backends.problem case final problem?)
            Padding(padding: Insets.topSm, child: Text(problem)),
          for (final backend in backends.backends)
            _BackendTile(
              backend: backend,
              status: backends.statuses[backend.id],
            ),
          if (backends.loaded && backends.backends.isEmpty)
            const Padding(
              padding: Insets.topSm,
              child: Text('The bridge serves no backend through the core yet.'),
            ),
        ],
      ),
    );
  }
}

class _ConnectionRow extends ConsumerWidget {
  const _ConnectionRow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final state = ref.watch(contractStateProvider).valueOrNull;
    final (label, color) = switch (state) {
      ContractReady(:final bridgeVersion) => (
        'Connected · bridge $bridgeVersion',
        theme.success,
      ),
      ContractNegotiating() => ('Agreeing on the protocol…', theme.warning),
      ContractIncompatible(:final detail) => (detail, theme.error),
      ContractOffline() || null => ('Not connected', theme.textMuted),
    };
    return Row(
      children: [
        Icon(AppIcons.link, color: color, size: 16),
        const SizedBox(width: Spacing.sm),
        Expanded(
          child: Text(label, style: AppTypography.body(color: color)),
        ),
      ],
    );
  }
}

class _BackendTile extends StatelessWidget {
  const _BackendTile({required this.backend, required this.status});

  final BackendDescriptor backend;
  final BackendStatus? status;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final known = status;
    final issues = known?.issues ?? const <StatusIssue>[];
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(backendLabel(backend.id), style: AppTypography.bodyLarge()),
      subtitle: issues.isEmpty
          ? null
          : Text(issues.map((issue) => issue.message).join('\n')),
      trailing: known == null
          ? null
          : StatusPill(
              label: known.usable ? 'Ready' : 'Not usable',
              color: known.usable ? theme.success : theme.error,
            ),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => SessionListScreen(backend: backend),
        ),
      ),
    );
  }
}
