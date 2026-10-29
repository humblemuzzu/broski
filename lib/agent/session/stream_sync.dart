import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/session/session_link.dart';
import 'package:broski/contract/generated/contract.dart';

/// What to do with one event of a session's stream (contract §7: `seq` runs
/// 1, 2, 3… per epoch, without gaps).
enum EventVerdict {
  apply,

  /// Applied already (a replay overlapping what arrived live), or not this
  /// phone's to apply.
  skip,

  /// Events were lost: attach again from the last position applied.
  resync,
}

EventVerdict judgeEvent(SessionLink link, int seq) {
  final position = positionOf(link);
  if (position == null || link is LinkWaiting) return EventVerdict.skip;
  if (seq <= position.seq) return EventVerdict.skip;
  if (seq == position.seq + 1) return EventVerdict.apply;
  return link is LinkLive ? EventVerdict.resync : EventVerdict.skip;
}

/// The link once event [seq] is applied.
SessionLink advanced(SessionLink link, int seq) => switch (link) {
  LinkLive(:final position) => LinkLive(
    StreamPosition(epoch: position.epoch, seq: seq),
  ),
  LinkAttaching(resume: final position?) => LinkAttaching(
    StreamPosition(epoch: position.epoch, seq: seq),
  ),
  _ => link,
};

/// [state] once the bridge answered an attach, or null when a replay does not
/// continue the stream this phone holds, which only a fresh attach repairs.
AgentSessionState? withAttachAnswer(
  AgentSessionState state,
  SessionAttachResponse answer,
) {
  switch (answer.sync) {
    case SnapshotSync(:final epoch, :final lastSeq, :final snapshot):
      return state.copyWith(
        link: LinkLive(StreamPosition(epoch: epoch, seq: lastSeq)),
        snapshot: snapshot,
        capabilities: answer.capabilities,
        prompts: withoutEchoed(state.prompts, snapshot.run?.items ?? const []),
        answering: {
          for (final MapEntry(:key, :value) in state.answering.entries)
            if (snapshot.interactions.any((asked) => asked.id == key))
              key: value,
        },
      );
    case ReplaySync(:final epoch, :final afterSeq):
      final held = positionOf(state.link);
      if (held == null || held.epoch != epoch || afterSeq > held.seq) {
        return null;
      }
      return state.copyWith(
        link: LinkLive(held),
        capabilities: answer.capabilities,
      );
  }
}

/// [prompts] without those [items] already show as user messages: the live
/// run's, or the history's.
List<OutgoingPrompt> withoutEchoed(
  List<OutgoingPrompt> prompts,
  List<TranscriptItem> items,
) {
  final echoed = {
    for (final item in items)
      if (item is UserMessageItem) ?item.clientRequestId,
  };
  return [
    for (final prompt in prompts)
      if (!echoed.contains(prompt.clientRequestId)) prompt,
  ];
}
