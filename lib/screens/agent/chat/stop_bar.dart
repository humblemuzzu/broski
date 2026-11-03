import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/widgets/chat/running_stop_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The chat's working bar for as long as the session runs, with the one
/// control that always ends the run: Stop.
class StopBar extends ConsumerWidget {
  const StopBar({super.key, required this.session, required this.state});

  final SessionRef session;
  final AgentSessionState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!state.running || !state.controllable) return const SizedBox.shrink();
    final waiting = state.status == SessionStatus.waitingForUser;
    return RunningStopBarView(
      barKey: const ValueKey('agent-stop-bar'),
      stopKey: const ValueKey('agent-stop'),
      spinnerLabel: 'The session is running',
      label: waiting ? 'Waiting for your answer' : 'Working',
      onStop: () =>
          ref.read(sessionProvider(session).notifier).controls.abort(),
    );
  }
}
