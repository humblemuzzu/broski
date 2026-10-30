import 'package:broski/agent/answers/answer_check.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/live_requests.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/session/session_cell.dart';
import 'package:broski/contract/generated/contract.dart';

/// Everything a person does to a running session beside prompting: stop it,
/// answer what it asks, drop queued input, change its model, thinking or
/// modes, compact it. A refusal is shown as a notice, never swallowed.
final class SessionControls {
  SessionControls(this._cell);

  final SessionCell _cell;

  Future<void> abort() async =>
      _report('Stop', await _cell.client.abort(_cell.ref));

  /// Checks [reply] with the contract's own rules first (contract §9): a
  /// faulted answer is never sent, nor a second one while the first is on its
  /// way. Returns why the answer was not taken, or null once the bridge took
  /// it. An answer that lost to another phone's is also told as a notice,
  /// since its ask may already be gone from view.
  Future<String?> answer(
    Interaction interaction,
    InteractionReply reply,
  ) async {
    final answer = InteractionAnswer(
      interactionId: interaction.id,
      reply: reply,
    );
    final problem = answerProblem(interaction, answer);
    if (problem != null) return problem;
    if (!_pending(interaction.id)) {
      return 'This is no longer waiting for an answer';
    }
    if (_cell.current.answering[interaction.id] is AnswerSending) {
      return 'Your answer is already on its way';
    }
    _setAnswering(interaction.id, const AnswerSending());
    final outcome = await _cell.client.answer(_cell.ref, answer);
    if (_cell.closed) return null;
    final refusal = switch (outcome) {
      Done() => null,
      Refused(:final rejection) when rejection.code == RejectionCode.stale =>
        'This was already answered',
      Refused() || Unreached() => problemOf(outcome),
    };
    if (refusal == null) return null;
    if (_pending(interaction.id)) {
      _setAnswering(interaction.id, AnswerNotTaken(refusal));
    } else {
      dismissAnswerProblem(interaction.id);
      _cell.notify(
        NoticeLevel.warning,
        'Your answer to “${interaction.title}” was not taken: $refusal',
      );
    }
    return refusal;
  }

  bool _pending(InteractionId id) =>
      _cell.current.snapshot.interactions.any((asked) => asked.id == id);

  Future<void> cancelQueued(QueueItemId queueItemId) async {
    final outcome = await _cell.client.cancelQueued(_cell.ref, queueItemId);
    if (_cell.closed) return;
    if (outcome is Done) {
      _cell.update(
        (state) => state.copyWith(
          prompts: [
            for (final prompt in state.prompts)
              if (!_queuedAs(prompt, queueItemId)) prompt,
          ],
        ),
      );
    }
    _report('Removing the queued message', outcome);
  }

  Future<void> cancelCompaction() async => _report(
    'Stopping the compaction',
    await _cell.client.cancelCompaction(_cell.ref),
  );

  Future<void> cancelRetry() async =>
      _report('Stopping the retry', await _cell.client.cancelRetry(_cell.ref));

  Future<void> setModel(ModelId modelId) async => _report(
    'Changing the model',
    await _cell.client.setModel(_cell.ref, modelId),
  );

  Future<void> setThinking(String thinking) async => _report(
    'Changing the thinking level',
    await _cell.client.setThinking(_cell.ref, thinking),
  );

  Future<void> setMode(ModeAxisId axis, String value) async => _report(
    'Changing the mode',
    await _cell.client.setMode(_cell.ref, axis, value),
  );

  Future<void> compact({String? instructions}) async => _report(
    'Compacting',
    await _cell.client.compact(_cell.ref, instructions: instructions),
  );

  /// Puts [text] in front of the composer's draft, as input the backend
  /// handed back: the message a tree jump returns to be edited and sent again.
  void returnInput(String text) => _cell.update(
    (state) => state.copyWith(returnedInput: [...state.returnedInput, text]),
  );

  /// The composer has taken the input the backend handed back.
  void clearReturnedInput() =>
      _cell.update((state) => state.copyWith(returnedInput: const []));

  /// Clears a refusal the person has read.
  void dismissAnswerProblem(InteractionId id) => _cell.update(
    (state) => state.copyWith(answering: {...state.answering}..remove(id)),
  );

  void _setAnswering(InteractionId id, AnswerProgress progress) => _cell.update(
    (state) => state.copyWith(answering: {...state.answering, id: progress}),
  );

  bool _queuedAs(OutgoingPrompt prompt, QueueItemId queueItemId) =>
      switch (prompt.delivery) {
        PromptTaken(:final accepted) => accepted.queueItemId == queueItemId,
        _ => false,
      };

  void _report<T>(String what, Outcome<T> outcome) {
    final problem = problemOf(outcome);
    if (problem == null || _cell.closed) return;
    _cell.notify(NoticeLevel.error, '$what failed: $problem');
  }
}
