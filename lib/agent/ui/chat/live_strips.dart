import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/ui/chat/notices_strip.dart';
import 'package:broski/agent/ui/chat/plan_card.dart';
import 'package:broski/agent/ui/chat/queue_strip.dart';
import 'package:broski/agent/ui/chat/run_banner.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What the live state shows beside the conversation, above the composer:
/// the todo plan, notices, retry and compaction, the queue.
class LiveStrips extends ConsumerWidget {
  const LiveStrips({super.key, required this.session, required this.state});

  final SessionRef session;
  final AgentSessionState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshot = state.snapshot;
    final capabilities = state.capabilities;
    final controls = ref.read(sessionProvider(session).notifier).controls;
    final controllable = state.controllable;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (snapshot.plan case final plan?) PlanCard(plan: plan),
        NoticesStrip(session: session, state: state),
        RunBanner(
          snapshot: snapshot,
          onCancelRetry: controllable && (capabilities?.cancelRetry ?? false)
              ? controls.cancelRetry
              : null,
          onCancelCompaction:
              controllable && (capabilities?.cancelCompaction ?? false)
              ? controls.cancelCompaction
              : null,
        ),
        if (snapshot.queue.isNotEmpty)
          QueueStrip(
            session: session,
            queue: snapshot.queue,
            cancellable: controllable && (capabilities?.cancelQueued ?? false),
          ),
      ],
    );
  }
}
