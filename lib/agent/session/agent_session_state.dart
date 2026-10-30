import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/session/session_history.dart';
import 'package:broski/agent/session/session_link.dart';
import 'package:broski/agent/session/session_notices.dart';
import 'package:broski/contract/generated/contract.dart';

/// Everything the phone holds about one session: the live state the reducer
/// builds, the finished history, what this phone sent and is answering, and
/// what the session allows.
final class AgentSessionState {
  const AgentSessionState({
    required this.ref,
    this.link = const LinkWaiting(),
    this.snapshot = const SessionSnapshot(
      blocks: [],
      tools: [],
      interactions: [],
      queue: [],
      modes: [],
    ),
    this.capabilities,
    this.summary,
    this.history = const SessionHistory(),
    this.prompts = const [],
    this.answering = const {},
    this.notices = const [],
    this.extensions = const {},
    this.returnedInput = const [],
  });

  final SessionRef ref;
  final SessionLink link;
  final SessionSnapshot snapshot;

  /// Known once attached (contract §6, `SessionCapabilities`).
  final SessionCapabilities? capabilities;

  /// The session's list row: title, directory, origin; kept current by the
  /// catalog's `session_updated`.
  final SessionSummary? summary;
  final SessionHistory history;
  final List<OutgoingPrompt> prompts;

  /// Interactions an answer of this phone is on its way to, or was refused
  /// for, with the reason; an entry ends when the interaction resolves.
  final Map<InteractionId, AnswerProgress> answering;
  final List<SessionNotice> notices;
  final Map<String, BackendExtension> extensions;

  /// Queued input the backend took back (`input_returned`, contract §7), in
  /// queue order, waiting for the composer to take it.
  final List<String> returnedInput;

  SessionStatus get status => sessionStatus(snapshot);

  /// Running, or about to: a prompt the bridge took to start a run counts
  /// from its acceptance, before `run_started` arrives.
  bool get running =>
      snapshot.run != null ||
      prompts.any(
        (prompt) => switch (prompt.delivery) {
          PromptTaken(:final accepted) =>
            accepted.disposition == PromptDisposition.started,
          _ => false,
        },
      );

  bool get controllable => capabilities?.controllable ?? false;

  AgentSessionState copyWith({
    SessionLink? link,
    SessionSnapshot? snapshot,
    SessionCapabilities? capabilities,
    SessionSummary? summary,
    SessionHistory? history,
    List<OutgoingPrompt>? prompts,
    Map<InteractionId, AnswerProgress>? answering,
    List<SessionNotice>? notices,
    Map<String, BackendExtension>? extensions,
    List<String>? returnedInput,
  }) => AgentSessionState(
    ref: ref,
    link: link ?? this.link,
    snapshot: snapshot ?? this.snapshot,
    capabilities: capabilities ?? this.capabilities,
    summary: summary ?? this.summary,
    history: history ?? this.history,
    prompts: prompts ?? this.prompts,
    answering: answering ?? this.answering,
    notices: notices ?? this.notices,
    extensions: extensions ?? this.extensions,
    returnedInput: returnedInput ?? this.returnedInput,
  );
}

sealed class AnswerProgress {
  const AnswerProgress();
}

final class AnswerSending extends AnswerProgress {
  const AnswerSending();
}

final class AnswerNotTaken extends AnswerProgress {
  const AnswerNotTaken(this.reason);

  final String reason;
}
