import 'dart:async';

import 'package:broski/agent/client/contract_failure.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/live_requests.dart';
import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/session/session_cell.dart';
import 'package:broski/agent/session/session_link.dart';
import 'package:broski/agent/session/stream_sync.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:uuid/uuid.dart';

/// What a person typed, before it becomes a [PromptInput].
final class PromptDraft {
  const PromptDraft({
    required this.mode,
    required this.text,
    this.attachments = const [],
    this.mentions = const [],
    this.command,
  });

  final PromptMode mode;
  final String text;
  final List<Attachment> attachments;
  final List<Mention> mentions;
  final CommandId? command;
}

/// How a prompt whose answer did not come is sent again.
enum _Resend {
  /// The bridge never took it: the person decides.
  never,

  /// Its fate is unknown and sending it again will not tell: the person
  /// decides.
  byPerson,

  /// Once the session is attached again.
  onAttach,

  /// After the session is attached again, which starts now.
  afterReattach,

  /// After a wait, while the session is live.
  afterWait,
}

/// Sends prompts (contract §10): each is shown at once, keyed by a fresh
/// `clientRequestId`, and leaves when the session echoes it. One whose fate
/// is unknown is sent again with the same id, which the bridge de-duplicates:
/// once the session is attached again, or after a wait while it stays live.
/// A refused one, or one the phone stopped trying, waits for the person.
final class PromptDesk {
  PromptDesk(this._cell, {String Function()? newId})
    : _newId = newId ?? const Uuid().v4;

  /// The waits before each automatic resend of a prompt the bridge could not
  /// serve (`rate_limited` past the client's own retries, `internal`, a lost
  /// answer). After the last, the prompt waits for the person.
  static const resendWaits = [
    Duration(seconds: 2),
    Duration(seconds: 8),
    Duration(seconds: 30),
  ];

  final SessionCell _cell;
  final String Function() _newId;
  final Map<ClientRequestId, int> _resends = {};
  final Map<ClientRequestId, int> _timers = {};
  var _timerTokens = 0;

  Future<void> send(PromptDraft draft) {
    final input = PromptInput(
      clientRequestId: _newId(),
      mode: draft.mode,
      text: draft.text,
      attachments: draft.attachments,
      mentions: draft.mentions,
      command: draft.command,
    );
    _cell.update(
      (state) => state.copyWith(
        prompts: [
          ...state.prompts,
          OutgoingPrompt(input: input, delivery: const PromptSending()),
        ],
      ),
    );
    return _deliver(input);
  }

  /// Sends again, with the same `clientRequestId`, a prompt that waits for
  /// the person: one not sent, or one not confirmed.
  Future<void> retry(ClientRequestId id) async {
    final prompt = _find(id);
    if (prompt == null || !prompt.waitsForPerson) return;
    _resends.remove(id);
    await _resend(prompt.input);
  }

  /// Every prompt that waits for the session to be attached again, sent again.
  void resendUnconfirmed() {
    for (final prompt in _cell.current.prompts) {
      if (prompt.delivery case PromptUnconfirmed(resending: true)) {
        _resend(prompt.input).ignore();
      }
    }
  }

  /// Takes back a prompt that waits for the person, to edit or drop it.
  PromptInput? withdraw(ClientRequestId id) {
    final prompt = _find(id);
    if (prompt == null || !prompt.waitsForPerson) return null;
    _drop(id);
    return prompt.input;
  }

  Future<void> _resend(PromptInput input) {
    _timers.remove(input.clientRequestId);
    _setDelivery(input.clientRequestId, const PromptSending());
    return _deliver(input);
  }

  Future<void> _deliver(PromptInput input) async {
    final outcome = await _cell.client.prompt(_cell.ref, input);
    if (_cell.closed) return;
    final id = input.clientRequestId;
    switch (outcome) {
      case Done(value: final accepted)
          when accepted.disposition == PromptDisposition.handled:
        _drop(id);
      case Done(value: final accepted):
        _forget(id);
        _setDelivery(id, PromptTaken(accepted));
        _dropIfEchoed();
      case Refused(:final rejection):
        _forget(id);
        _setDelivery(id, PromptNotSent(rejection.message));
      case Unreached(:final failure):
        _unreached(id, failure);
    }
  }

  void _unreached(ClientRequestId id, ContractFailure failure) {
    final reason = failure.message;
    switch (_resendOf(failure)) {
      case _Resend.never:
        _setDelivery(id, PromptNotSent(reason));
      case _Resend.byPerson:
        _setDelivery(id, PromptUnconfirmed(reason, resending: false));
      case _Resend.onAttach:
        _setDelivery(id, PromptUnconfirmed(reason, resending: true));
      case _Resend.afterReattach:
        _setDelivery(id, PromptUnconfirmed(reason, resending: true));
        _cell.reattach();
      case _Resend.afterWait:
        _resendLater(id, reason);
    }
  }

  /// The bridge refuses with an `error` only what it did not serve (contract
  /// §12.1), except `internal`: a backend that missed the core's deadline may
  /// still take the prompt.
  _Resend _resendOf(ContractFailure failure) => switch (failure) {
    ConnectionLost() => _Resend.onAttach,
    ProtocolRefusal(code: ProtocolErrorCode.notAttached) =>
      _Resend.afterReattach,
    ProtocolRefusal(
      code: ProtocolErrorCode.internal || ProtocolErrorCode.rateLimited,
    ) ||
    AnswerTimedOut() => _Resend.afterWait,
    MalformedAnswer() || ClientClosed() => _Resend.byPerson,
    ProtocolRefusal() || LinkRefusal() || VersionMismatch() => _Resend.never,
  };

  void _resendLater(ClientRequestId id, String reason) {
    final attempt = _resends[id] ?? 0;
    if (attempt >= resendWaits.length) {
      _resends.remove(id);
      _setDelivery(id, PromptUnconfirmed(reason, resending: false));
      return;
    }
    _resends[id] = attempt + 1;
    _setDelivery(id, PromptUnconfirmed(reason, resending: true));
    final token = ++_timerTokens;
    _timers[id] = token;
    unawaited(
      _cell.wait(resendWaits[attempt]).then((_) => _resendDue(id, token)),
    );
  }

  /// A wait ended. While attaching or waiting for the connection, the attach
  /// that follows sends the prompt; a session that cannot be followed leaves
  /// it to the person.
  void _resendDue(ClientRequestId id, int token) {
    if (_cell.closed || _timers[id] != token) return;
    final prompt = _find(id);
    if (prompt == null) return _forget(id);
    _timers.remove(id);
    if (prompt.delivery case PromptUnconfirmed(
      :final reason,
      resending: true,
    )) {
      switch (_cell.current.link) {
        case LinkLive():
          _resend(prompt.input).ignore();
        case LinkAttaching() || LinkWaiting():
          break;
        case LinkLost() || LinkReplaced():
          _setDelivery(id, PromptUnconfirmed(reason, resending: false));
      }
    }
  }

  void _forget(ClientRequestId id) {
    _resends.remove(id);
    _timers.remove(id);
  }

  void _drop(ClientRequestId id) {
    _forget(id);
    _cell.update(
      (state) => state.copyWith(
        prompts: [
          for (final held in state.prompts)
            if (held.clientRequestId != id) held,
        ],
      ),
    );
  }

  /// A prompt sent again after a reconnect may have run while the phone was
  /// away: its echo is then in the history, and the bridge's answer is the
  /// first one's.
  void _dropIfEchoed() => _cell.update(
    (state) => state.copyWith(
      prompts: withoutEchoed(state.prompts, [
        ...state.history.items,
        ...?state.snapshot.run?.items,
      ]),
    ),
  );

  OutgoingPrompt? _find(ClientRequestId id) => _cell.current.prompts
      .where((prompt) => prompt.clientRequestId == id)
      .firstOrNull;

  /// Changes a prompt still held; one the session already echoed is gone.
  void _setDelivery(ClientRequestId id, PromptDelivery delivery) =>
      _cell.update(
        (state) => state.copyWith(
          prompts: [
            for (final held in state.prompts)
              held.clientRequestId == id ? held.delivered(delivery) : held,
          ],
        ),
      );
}
