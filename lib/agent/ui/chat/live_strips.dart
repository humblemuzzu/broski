import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/ui/chat/notices_strip.dart';
import 'package:broski/agent/ui/chat/plan_card.dart';
import 'package:broski/agent/ui/chat/queue_strip.dart';
import 'package:broski/agent/ui/chat/run_banner.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';

/// What the live state shows beside the conversation, above the composer:
/// the todo plan, notices, retry and compaction, the queue.
class LiveStrips extends StatelessWidget {
  const LiveStrips({super.key, required this.session, required this.state});

  final SessionRef session;
  final AgentSessionState state;

  @override
  Widget build(BuildContext context) {
    final snapshot = state.snapshot;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (snapshot.plan case final plan?) PlanCard(plan: plan),
        NoticesStrip(session: session, state: state),
        RunBanner(snapshot: snapshot),
        if (snapshot.queue.isNotEmpty)
          QueueStrip(
            session: session,
            queue: snapshot.queue,
            cancellable:
                state.controllable &&
                (state.capabilities?.cancelQueued ?? false),
          ),
      ],
    );
  }
}
