import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shown for as long as the session runs, with the one control that always
/// ends the run: Stop.
class StopBar extends ConsumerWidget {
  const StopBar({super.key, required this.session, required this.state});

  final SessionRef session;
  final AgentSessionState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!state.running || !state.controllable) return const SizedBox.shrink();
    final theme = OpenCodeTheme.of(context);
    final waiting = state.status == SessionStatus.waitingForUser;
    return Container(
      key: const ValueKey('agent-stop-bar'),
      padding: Insets.chipH,
      color: theme.primary.withValues(alpha: 0.08),
      child: Row(
        children: [
          const SizedBox.square(
            dimension: 12,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              semanticsLabel: 'The session is running',
            ),
          ),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Text(
              waiting ? 'Waiting for your answer' : 'Working',
              style: AppTypography.label(color: theme.primary),
            ),
          ),
          TextButton.icon(
            key: const ValueKey('agent-stop'),
            onPressed: () =>
                ref.read(sessionProvider(session).notifier).controls.abort(),
            icon: Icon(AppIcons.cancel, size: 16, color: theme.error),
            label: Text('Stop', style: AppTypography.label(color: theme.error)),
          ),
        ],
      ),
    );
  }
}
