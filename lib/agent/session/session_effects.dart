import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/session/session_link.dart';
import 'package:broski/agent/session/session_notices.dart';
import 'package:broski/contract/generated/contract.dart';

/// What an event does beyond the live state the reducer builds: the prompts
/// it echoes, the run it settles into history, the answer it ends, the notice
/// it shows. [before] is the state the event applied to; [after] carries the
/// reduced snapshot and the advanced link.
AgentSessionState withEventEffects(
  AgentSessionState before,
  AgentSessionState after,
  AgentEvent event, {
  required SessionNotice Function(NoticeLevel level, String text) notice,
}) => switch (event) {
  UserMessageEvent(clientRequestId: final id?) => after.copyWith(
    prompts: [
      for (final prompt in after.prompts)
        if (prompt.clientRequestId != id) prompt,
    ],
  ),
  RunFinishedEvent() => _runFinished(before, after),
  InteractionResolvedEvent(:final interactionId) => after.copyWith(
    answering: {...after.answering}..remove(interactionId),
  ),
  ResyncedEvent(:final snapshot) => after.copyWith(
    answering: {
      for (final MapEntry(:key, :value) in after.answering.entries)
        if (snapshot.interactions.any((asked) => asked.id == key)) key: value,
    },
  ),
  NoticeEvent(:final level, :final text) => after.copyWith(
    notices: withNotice(after.notices, notice(level, text)),
  ),
  ErrorEvent(:final error) => after.copyWith(
    notices: withNotice(
      after.notices,
      notice(NoticeLevel.error, error.message),
    ),
  ),
  ExtensionEvent(:final extension) => after.copyWith(
    extensions: withExtension(after.extensions, extension),
  ),
  SessionReplacedEvent(:final session) => after.copyWith(
    link: LinkReplaced(session),
  ),
  _ => after,
};

/// The finished run's items wait in history for the re-read of the newest
/// page (contract §8). A prompt the bridge took that is neither echoed nor
/// still queued belonged to that run, or was withdrawn: the transcript has it.
AgentSessionState _runFinished(
  AgentSessionState before,
  AgentSessionState after,
) {
  final run = before.snapshot.run;
  return after.copyWith(
    history: run == null ? after.history : after.history.withSettledRun(run),
    prompts: [
      for (final prompt in after.prompts)
        if (prompt.delivery is! PromptTaken ||
            isQueued(prompt, after.snapshot.queue))
          prompt,
    ],
  );
}

/// Whether [prompt] waits in the backend's visible queue.
bool isQueued(OutgoingPrompt prompt, List<QueueItem> queue) {
  final queueItemId = switch (prompt.delivery) {
    PromptTaken(:final accepted) => accepted.queueItemId,
    _ => null,
  };
  return queue.any(
    (item) =>
        item.clientRequestId == prompt.clientRequestId ||
        (queueItemId != null && item.id == queueItemId),
  );
}
