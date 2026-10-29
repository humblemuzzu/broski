import 'package:broski/agent/reducer/live_state.dart';
import 'package:broski/agent/reducer/run_items.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/contract/generated/contract.dart';

/// The Dart port of the contract's `session-reducer.ts`: the executable
/// meaning of every event. `test/agent/reducer/reducer_trace_test.dart`
/// replays the TypeScript reducer's own output and requires equal JSON after
/// every event.
SessionSnapshot emptySnapshot() => const SessionSnapshot(
  blocks: [],
  tools: [],
  interactions: [],
  queue: [],
  modes: [],
);

/// What a session is doing, as the snapshot says.
SessionStatus sessionStatus(SessionSnapshot snapshot) {
  if (snapshot.interactions.any((interaction) => interaction.blocksRun)) {
    return SessionStatus.waitingForUser;
  }
  if (snapshot.run != null) return SessionStatus.running;
  if (snapshot.lastOutcome is RunSuspended) return SessionStatus.suspended;
  return SessionStatus.idle;
}

/// The live state after [event], which happened at [at].
SessionSnapshot applyEvent(
  SessionSnapshot snapshot,
  Timestamp at,
  AgentEvent event,
) {
  final live = applyToLiveState(snapshot, at, event);
  final liveRun = live.run;
  if (snapshot.run == null || liveRun == null) return live;
  return replacing(live, run: nextRun(liveRun, snapshot, at, event));
}
