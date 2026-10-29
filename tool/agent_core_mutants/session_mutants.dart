import 'mutant.dart';

/// Mutants of the session store: attach, order, retries, prompts, answers.
final sessionMutants = [
  ...mutantsOf('session/session_controller.dart', const [
    Mutant(
      'attach: an overtaken answer is applied',
      'if (attempt != _attaches) {',
      'if (false) {',
    ),
    Mutant(
      'attach: what follows an overtaken answer is kept',
      'if (reply case Answered(:final arrival)) _held.staleAnswer(arrival);',
      '',
    ),
    Mutant(
      'attach: events sent before the answer are dropped',
      '    final released = _held.release(arrival);\n'
          '    released.before.forEach(_judge);',
      '    final released = _held.release(arrival);',
    ),
    Mutant(
      'attach: events sent after the answer are dropped',
      '      _receive(held.arrival, held.envelope);',
      '',
    ),
    Mutant(
      'attach: a lost event reattaches nothing',
      'if (released.lost) {',
      'if (false) {',
    ),
    Mutant(
      'attach: unknown_session is not final',
      'case ProtocolRefusal(code: ProtocolErrorCode.unknownSession):',
      'case ProtocolRefusal(code: ProtocolErrorCode.notAttached):',
    ),
    Mutant(
      'attach: a failure is not tried again',
      '        _retryAttachLater();',
      '',
    ),
    Mutant(
      'attach: the waits do not grow',
      'attachRetryWaits[min(_attachRetries, attachRetryWaits.length - 1)]',
      'attachRetryWaits.first',
    ),
    Mutant(
      'attach: a try outlives a newer attach',
      '!_closed && attempt == _attaches && client.state',
      '!_closed && client.state',
    ),
    Mutant(
      'offline: a failed attach still says it tries again',
      'link is LinkLive || link is LinkAttaching || link is LinkWaiting',
      'link is LinkLive || link is LinkAttaching',
    ),
    Mutant(
      'attach: a failed attach drops what was held',
      '    _held.release().before.forEach(_judge);\n'
          '    if (state.link is LinkReplaced) return;\n'
          '    final applied',
      '    if (state.link is LinkReplaced) return;\n    final applied',
    ),
    Mutant(
      'lost: a pending attach answer revives it',
      '    _attaches++;\n    _held.release();',
      '    _held.release();',
    ),
    Mutant(
      'lost: a new connection attaches it again',
      'if (state.link is! LinkLost) unawaited(attach());',
      'unawaited(attach());',
    ),
    Mutant(
      'offline: what was held is dropped',
      '        if (state.link is LinkAttaching) {\n'
          '          _held.release().before.forEach(_judge);\n'
          '        }\n',
      '',
    ),
    Mutant(
      'order: events apply while attaching',
      'if (state.link is LinkAttaching) {\n      _held.hold',
      'if (false) {\n      _held.hold',
    ),
    Mutant(
      'replaced: prompts are not handed over',
      '_handoff.leave(next, state.prompts);',
      '',
    ),
    Mutant(
      'replaced: the old session keeps the prompts it handed over',
      'return state.copyWith(link: LinkReplaced(next), prompts: const []);',
      'return state.copyWith(link: LinkReplaced(next));',
    ),
    Mutant(
      'replaced: an answer of "replaced" is not followed',
      '      case AttachMoved(:final next):\n        update((state) => _handedOver(state, next));\n        return;',
      '      case AttachMoved():\n        return;',
    ),
    Mutant(
      'replaced: a session reached by a replacement says nothing',
      "          notice(\n            NoticeLevel.info,\n            'This conversation continued in a new session',\n          ),",
      '          notice(NoticeLevel.info, \'\'),',
    ),
    Mutant(
      'replaced: every session says it was reached by a replacement',
      'final prompts = _handoff.take(ref);\n    if (prompts == null) return;',
      'final prompts = _handoff.take(ref) ?? const [];',
    ),
    Mutant(
      'problem: an unreadable event while attaching is forgotten',
      '_held.markLost();',
      '',
    ),
    Mutant(
      'reattach: also while not live',
      'if (state.link is LinkLive) unawaited(attach());',
      'unawaited(attach());',
    ),
    Mutant(
      'dispose: waits outlive the controller',
      '    _delays.close();\n',
      '',
    ),
  ]),
  ...mutantsOf('session/held_events.dart', const [
    Mutant('held: no bound', 'if (_held.length >= limit) {', 'if (false) {'),
    Mutant(
      'held: the newest stale answer counts',
      '_staleFrom ??= arrival',
      '_staleFrom = arrival',
    ),
    Mutant(
      'held: the answer splits at or after',
      'held.arrival < answer',
      'held.arrival <= answer',
      equivalent:
          'an answer and an event never share an arrival: each frame has its '
          'own number',
    ),
    Mutant(
      'held: stale events are kept',
      '(staleFrom == null || held.arrival < staleFrom)',
      'true',
    ),
  ]),
  ...mutantsOf('session/stream_sync.dart', const [
    Mutant(
      'order: a repeat applies',
      'if (seq <= position.seq) return EventVerdict.skip;',
      'if (seq < position.seq) return EventVerdict.skip;',
    ),
    Mutant(
      'order: an event applies while waiting',
      'if (position == null || link is LinkWaiting) return EventVerdict.skip;',
      'if (position == null) return EventVerdict.skip;',
    ),
    Mutant(
      'order: a replay of another epoch continues',
      'held.epoch != epoch || afterSeq > held.seq',
      'afterSeq > held.seq',
    ),
    Mutant(
      'order: a gap while attaching resyncs',
      'return link is LinkLive ? EventVerdict.resync : EventVerdict.skip;',
      'return EventVerdict.resync;',
    ),
  ]),
  ...mutantsOf('session/prompt_desk.dart', const [
    Mutant(
      'prompt: a lost connection is not sent again',
      'ConnectionLost() => _Resend.onAttach,',
      'ConnectionLost() => _Resend.never,',
    ),
    Mutant(
      'prompt: not_attached does not reattach',
      '        _cell.reattach();\n',
      '',
    ),
    Mutant(
      'prompt: rate_limited is not sent again',
      'code: ProtocolErrorCode.internal || ProtocolErrorCode.rateLimited,',
      'code: ProtocolErrorCode.internal,',
    ),
    Mutant(
      'prompt: a lost answer is final',
      '    AnswerTimedOut() => _Resend.afterWait,',
      '    AnswerTimedOut() => _Resend.never,',
    ),
    Mutant(
      'prompt: an unreadable answer reads as not sent',
      'MalformedAnswer() || ClientClosed() => _Resend.byPerson,',
      'MalformedAnswer() || ClientClosed() => _Resend.never,',
    ),
    Mutant(
      'prompt: one more automatic resend',
      'if (attempt >= resendWaits.length) {',
      'if (attempt > resendWaits.length) {',
    ),
    Mutant(
      'prompt: an old wait sends again',
      'if (_cell.closed || _timers[id] != token) return;',
      'if (_cell.closed) return;',
    ),
    Mutant(
      'prompt: a due resend is not sent',
      '          _resend(prompt.input).ignore();\n        case LinkAttaching()',
      '          break;\n        case LinkAttaching()',
    ),
    Mutant(
      'prompt: a lost session still says it resends',
      '          _setDelivery(id, PromptUnconfirmed(reason, resending: false));\n'
          '      }',
      '          break;\n      }',
    ),
    Mutant(
      'prompt: a retry keeps the old count',
      '    _resends.remove(id);\n    await _resend(prompt.input);',
      '    await _resend(prompt.input);',
    ),
    Mutant(
      'prompt: the attach resends every unconfirmed one',
      'if (prompt.delivery case PromptUnconfirmed(resending: true)) {',
      'if (prompt.delivery case PromptUnconfirmed()) {',
    ),
  ]),
  ...mutantsOf('session/outgoing_prompt.dart', const [
    Mutant(
      'prompt: an unconfirmed one does not wait for the person',
      'PromptNotSent() || PromptUnconfirmed() => true,',
      'PromptNotSent() => true,\n    PromptUnconfirmed() => false,',
    ),
  ]),
  ...mutantsOf('session/stream_sync.dart', const [
    Mutant(
      'replaced: the answer is taken for an attach',
      '    case ReplacedSync(:final session):\n      return AttachMoved(session);',
      '    case ReplacedSync():\n      return AttachApplied(state);',
    ),
  ]),
  ...mutantsOf('session/prompt_handoff.dart', const [
    Mutant('handoff: no bound', 'if (_waiting.length >= limit)', 'if (false)'),
    Mutant(
      'handoff: an unconfirmed prompt keeps resending',
      'PromptSending() || PromptUnconfirmed() => prompt.delivered(',
      'PromptSending() => prompt.delivered(',
    ),
  ]),
  ...mutantsOf('session/session_controls.dart', const [
    Mutant(
      'answer: a second answer is sent',
      'if (_cell.current.answering[interaction.id] is AnswerSending) {',
      'if (false) {',
    ),
    Mutant(
      'answer: an ended ask is answered',
      'if (!_pending(interaction.id)) {\n      return',
      'if (false) {\n      return',
    ),
  ]),
  ...mutantsOf('session/history_loader.dart', const [
    Mutant(
      'history: an overtaken read lands',
      'if (_cell.closed || read != _newestReads) return;',
      'if (_cell.closed) return;',
    ),
  ]),
  ...mutantsOf('session/session_history.dart', const [
    Mutant(
      'history: a rewrite keeps older pages',
      '!rewritten &&\n        page.idStability',
      'page.idStability',
    ),
  ]),
  ...mutantsOf('session/session_effects.dart', const [
    Mutant(
      'effects: a resync keeps answers to asks it dropped',
      '  ResyncedEvent(:final snapshot) => after.copyWith(',
      '  ResyncedEvent(:final snapshot) when snapshot.interactions.isEmpty &&\n'
          '      false => after.copyWith(',
    ),
    Mutant(
      'effects: an echo leaves its prompt',
      'if (prompt.clientRequestId != id) prompt,',
      'prompt,',
    ),
    Mutant(
      'effects: a taken prompt outlives its run',
      'if (prompt.delivery is! PromptTaken ||\n'
          '            isQueued(prompt, after.snapshot.queue))',
      'if (true)',
    ),
  ]),
];
