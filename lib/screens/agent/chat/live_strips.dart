import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/notices_strip.dart';
import 'package:broski/screens/agent/chat/plan_card.dart';
import 'package:broski/screens/agent/chat/queue_strip.dart';
import 'package:broski/screens/agent/chat/run_banner.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What the live state shows above the input bar: the todo plan, notices,
/// retry and compaction, the queue.
class LiveStrips extends ConsumerWidget {
  const LiveStrips({
    super.key,
    required this.session,
    required this.state,
    this.onOpenPlan,
  });

  final SessionRef session;
  final AgentSessionState state;
  final VoidCallback? onOpenPlan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshot = state.snapshot;
    final capabilities = state.capabilities;
    final controls = ref.read(sessionProvider(session).notifier).controls;
    final controllable = state.controllable;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (snapshot.plan case final plan? when plan.items.isNotEmpty)
          PlanCard(plan: plan, onTap: onOpenPlan),
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
