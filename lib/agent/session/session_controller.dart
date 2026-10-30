import 'dart:async';
import 'dart:math';

import 'package:broski/agent/client/agent_clock.dart';
import 'package:broski/agent/client/client_delays.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_failure.dart';
import 'package:broski/agent/client/contract_problem.dart';
import 'package:broski/agent/client/contract_reply.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/live_requests.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/held_events.dart';
import 'package:broski/agent/session/history_loader.dart';
import 'package:broski/agent/session/prompt_desk.dart';
import 'package:broski/agent/session/prompt_handoff.dart';
import 'package:broski/agent/session/session_cell.dart';
import 'package:broski/agent/session/session_controls.dart';
import 'package:broski/agent/session/session_effects.dart';
import 'package:broski/agent/session/session_link.dart';
import 'package:broski/agent/session/session_notices.dart';
import 'package:broski/agent/session/stream_sync.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// One attached session (contract §8, §12.2): attaches on every new
/// connection with the last position it applied, applies each event in `seq`
/// order with the contract's reducer, reattaches across a gap, and keeps the
/// finished history, prompts and answers beside the live state.
final class SessionController extends StateNotifier<AgentSessionState>
    implements SessionCell {
  SessionController({
    required this.client,
    required this.ref,
    AgentClock clock = const SystemClock(),
    PromptHandoff? handoff,
    String Function()? newPromptId,
  }) : _clock = clock,
       _delays = ClientDelays(clock),
       _handoff = handoff ?? PromptHandoff(),
       super(AgentSessionState(ref: ref)) {
    history = HistoryLoader(this);
    prompts = PromptDesk(this, newId: newPromptId);
    controls = SessionControls(this);
    _arrive();
    _subscriptions.addAll([
      client.events.listen(_onEnvelope),
      client.states.listen(_onClientState),
      client.catalog.listen(_onCatalog),
      client.problems.listen(_onProblem),
    ]);
    _onClientState(client.state);
  }

  /// The waits before an attach the bridge could not serve is tried again;
  /// the last repeats for as long as the connection stays up.
  static const attachRetryWaits = [
    Duration(seconds: 2),
    Duration(seconds: 4),
    Duration(seconds: 8),
    Duration(seconds: 16),
    Duration(seconds: 30),
  ];

  @override
  final ContractClient client;
  @override
  final SessionRef ref;
  final AgentClock _clock;
  final ClientDelays _delays;
  final PromptHandoff _handoff;
  late final HistoryLoader history;
  late final PromptDesk prompts;
  late final SessionControls controls;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  final _held = HeldEvents();
  var _generation = 0;
  var _attaches = 0;
  var _attachRetries = 0;
  var _notices = 0;
  var _closed = false;

  @override
  AgentSessionState get current => state;

  @override
  bool get closed => _closed;

  @override
  void update(AgentSessionState Function(AgentSessionState state) change) {
    if (!_closed) state = change(state);
  }

  @override
  SessionNotice notice(NoticeLevel level, String text) =>
      SessionNotice(id: ++_notices, level: level, text: text, at: _clock.now());

  @override
  void notify(NoticeLevel level, String text) => update(
    (state) =>
        state.copyWith(notices: withNotice(state.notices, notice(level, text))),
  );

  @override
  Future<void> wait(Duration delay) => _delays.wait(delay);

  @override
  void reattach() {
    if (state.link is LinkLive) unawaited(attach());
  }

  void dismissNotice(int id) => update(
    (state) => state.copyWith(
      notices: [
        for (final held in state.notices)
          if (held.id != id) held,
      ],
    ),
  );

  /// Attaches with the last position applied, or afresh when [fresh]. An
  /// attach this one overtakes is ignored when it answers.
  Future<void> attach({bool fresh = false}) async {
    if (_closed || state.link is LinkReplaced) return;
    final resume = fresh ? null : positionOf(state.link);
    final attempt = ++_attaches;
    update((state) => state.copyWith(link: LinkAttaching(resume)));
    final reply = await client.attach(ref, resume: resume);
    if (_closed) return;
    if (attempt != _attaches) {
      if (reply case Answered(:final arrival)) _held.staleAnswer(arrival);
      return;
    }
    switch (reply) {
      case Answered(response: final answer, :final arrival):
        _attached(answer, arrival);
      case Failed(:final failure):
        _attachFailed(failure);
    }
  }

  /// Applies, in the order the bridge sent them, the events that arrived
  /// before the answer, the answer, then the events after it.
  void _attached(SessionAttachResponse answer, int arrival) {
    final released = _held.release(arrival);
    released.before.forEach(_judge);
    if (state.link is LinkReplaced) return;
    final AgentSessionState applied;
    switch (attachOutcome(state, answer)) {
      case AttachRestart():
        unawaited(attach(fresh: true));
        return;
      case AttachMoved(:final next) when next == ref:
        unawaited(attach(fresh: true));
        return;
      case AttachMoved(:final next):
        update((state) => _handedOver(state, next));
        return;
      case AttachApplied(applied: final next):
        applied = next;
    }
    _attachRetries = 0;
    update((_) => applied);
    if (answer.sync is SnapshotSync || !state.history.loaded) {
      unawaited(history.refreshNewest());
    }
    if (state.summary == null) unawaited(_loadSummary());
    prompts.resendUnconfirmed();
    if (released.lost) {
      unawaited(attach());
      return;
    }
    for (final held in released.after) {
      _receive(held.arrival, held.envelope);
    }
  }

  /// Only a session the bridge no longer knows is lost; anything else is
  /// tried again, after a wait while connected, or on the next connection.
  void _attachFailed(ContractFailure failure) {
    _held.release().before.forEach(_judge);
    if (state.link is LinkReplaced) return;
    final applied = positionOf(state.link);
    switch (failure) {
      case ConnectionLost() || ClientClosed():
        update((state) => state.copyWith(link: LinkWaiting(applied)));
      case ProtocolRefusal(code: ProtocolErrorCode.unknownSession):
        _lose('This session no longer exists');
      case ProtocolRefusal() ||
          LinkRefusal() ||
          AnswerTimedOut() ||
          VersionMismatch() ||
          MalformedAnswer():
        update(
          (state) =>
              state.copyWith(link: LinkWaiting(applied, failure.message)),
        );
        _retryAttachLater();
    }
  }

  /// Every way out of [LinkWaiting] starts an attach or loses the session,
  /// both of which move [_attaches] on, so an unchanged count means the
  /// session still waits for this try.
  void _retryAttachLater() {
    final wait =
        attachRetryWaits[min(_attachRetries, attachRetryWaits.length - 1)];
    _attachRetries++;
    final attempt = _attaches;
    unawaited(
      _delays.wait(wait).then((_) {
        final due =
            !_closed && attempt == _attaches && client.state is ContractReady;
        if (due) unawaited(attach());
      }),
    );
  }

  /// [state] once the conversation goes on as [next]: the prompts not echoed
  /// leave for it, and this session is followed no more.
  AgentSessionState _handedOver(AgentSessionState state, SessionRef next) {
    _handoff.leave(next, state.prompts);
    return state.copyWith(link: LinkReplaced(next), prompts: const []);
  }

  /// Takes what a replaced session left for this one, and says so.
  void _arrive() {
    final prompts = _handoff.take(ref);
    if (prompts == null) return;
    update(
      (state) => state.copyWith(
        prompts: prompts,
        notices: withNotice(
          state.notices,
          notice(
            NoticeLevel.info,
            'This conversation continued in a new session',
          ),
        ),
      ),
    );
  }

  void _lose(String reason) {
    if (state.link is LinkReplaced) return;
    _attaches++;
    _held.release();
    update((state) => state.copyWith(link: LinkLost(reason)));
  }

  Future<void> _loadSummary() async {
    final outcome = await client.getSession(ref);
    if (outcome case Done(value: final summary)) {
      update((state) => state.copyWith(summary: summary));
    }
  }

  void _onClientState(ContractState next) {
    switch (next) {
      case ContractReady(:final generation) when generation != _generation:
        _generation = generation;
        if (state.link is! LinkLost) unawaited(attach());
      case ContractOffline() || ContractIncompatible():
        if (state.link is LinkAttaching) {
          _held.release().before.forEach(_judge);
        }
        final link = state.link;
        if (link is LinkLive || link is LinkAttaching || link is LinkWaiting) {
          update(
            (state) => state.copyWith(link: LinkWaiting(positionOf(link))),
          );
        }
      case ContractReady() || ContractNegotiating():
        break;
    }
  }

  void _onEnvelope(EventEnvelope envelope) {
    if (envelope.session == ref) _receive(client.received, envelope);
  }

  void _receive(int arrival, EventEnvelope envelope) {
    if (_closed) return;
    if (state.link is LinkAttaching) {
      _held.hold(arrival, envelope);
    } else {
      _judge(envelope);
    }
  }

  void _judge(EventEnvelope envelope) {
    switch (judgeEvent(state.link, envelope.seq)) {
      case EventVerdict.skip:
        return;
      case EventVerdict.resync:
        unawaited(attach());
      case EventVerdict.apply:
        _apply(envelope);
    }
  }

  void _apply(EventEnvelope envelope) {
    final before = state;
    final event = envelope.event;
    final reduced = before.copyWith(
      snapshot: applyEvent(before.snapshot, envelope.at, event),
      link: advanced(before.link, envelope.seq),
    );
    final after = withEventEffects(before, reduced, event, notice: notice);
    if (event case SessionReplacedEvent(:final session)) {
      update((_) => session == ref ? after : _handedOver(after, session));
      if (session == ref) unawaited(attach(fresh: true));
      return;
    }
    update((_) => after);
    if (event is RunFinishedEvent) unawaited(history.refreshNewest());
  }

  void _onCatalog(CatalogMessage message) {
    switch (message.event) {
      case TranscriptInvalidatedEvent(:final session) when session == ref:
        unawaited(history.refreshNewest(rewritten: true));
      case SessionRemovedEvent(:final session) when session == ref:
        _lose('This session was deleted');
      case SessionUpdatedEvent(:final summary) when summary.session == ref:
        update((state) => state.copyWith(summary: summary));
      default:
        return;
    }
  }

  /// An event of this session could not be read: what it carried is lost.
  void _onProblem(ContractProblem problem) {
    if (problem case UnreadableFrame(:final session) when session == ref) {
      switch (state.link) {
        case LinkLive():
          unawaited(attach());
        case LinkAttaching():
          _held.markLost();
        case LinkWaiting() || LinkLost() || LinkReplaced():
          break;
      }
    }
  }

  @override
  void dispose() {
    _closed = true;
    _delays.close();
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    final link = state.link;
    if ((link is LinkLive || link is LinkAttaching) &&
        client.state is ContractReady) {
      unawaited(client.detach(ref));
    }
    super.dispose();
  }
}
