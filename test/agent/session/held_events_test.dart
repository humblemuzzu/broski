import 'package:broski/agent/session/held_events.dart';
import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/session/prompt_handoff.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';

EventEnvelope _event(int seq) => EventEnvelope(
  session: sessionRef,
  seq: seq,
  at: 1,
  event: const NoticeEvent(level: NoticeLevel.info, text: 'n'),
);

List<int> _seqs(Iterable<EventEnvelope> events) => [
  for (final event in events) event.seq,
];

void main() {
  group('held events', () {
    test('split at the answer: before it, after it, or all before when '
        'none came', () {
      final held = HeldEvents()
        ..hold(1, _event(1))
        ..hold(3, _event(2));
      final split = held.release(2);
      expect(_seqs(split.before), [1]);
      expect(_seqs(split.after.map((event) => event.envelope)), [2]);
      expect(split.after.single.arrival, 3);
      held.hold(5, _event(3));
      expect(_seqs(held.release().before), [3]);
      expect(held.release().before, isEmpty, reason: 'released once');
    });

    test('drop what follows the first overtaken answer until the next', () {
      final held = HeldEvents()
        ..hold(1, _event(1))
        ..staleAnswer(2)
        ..hold(3, _event(9))
        ..staleAnswer(4)
        ..hold(5, _event(10))
        ..hold(7, _event(1));
      final split = held.release(6);
      expect(_seqs(split.before), [1]);
      expect(_seqs(split.after.map((event) => event.envelope)), [1]);
      held.hold(8, _event(2));
      expect(_seqs(held.release(9).before), [2], reason: 'the mark is gone');
    });

    test('past the bound, or with an unreadable event, say some are lost', () {
      final held = HeldEvents();
      for (var seq = 1; seq <= HeldEvents.limit + 1; seq++) {
        held.hold(seq, _event(seq));
      }
      final overflowed = held.release(HeldEvents.limit + 5);
      expect(overflowed.lost, isTrue);
      expect(overflowed.before.length, lessThanOrEqualTo(HeldEvents.limit));
      held.hold(1, _event(1));
      expect(held.release().lost, isFalse);
      held.markLost();
      expect(held.release().lost, isTrue);
    });
  });

  group('prompt handoff', () {
    OutgoingPrompt prompt(String id, PromptDelivery delivery) => OutgoingPrompt(
      input: PromptInput(
        clientRequestId: id,
        mode: PromptMode.start,
        text: id,
        attachments: const [],
        mentions: const [],
      ),
      delivery: delivery,
    );

    test('is taken once, by the session it was left for', () {
      final handoff = PromptHandoff()
        ..leave(sessionRef, [prompt('a', const PromptNotSent('no'))]);
      expect(handoff.take(sessionRef)?.single.clientRequestId, 'a');
      expect(handoff.take(sessionRef), isNull);
    });

    test('is left even with no prompts, so the session knows it was reached '
        'by a replacement', () {
      final handoff = PromptHandoff()..leave(sessionRef, const []);
      expect(handoff.take(sessionRef), isEmpty);
      expect(handoff.take(sessionRef), isNull);
    });

    test('keeps the newest sessions only', () {
      final handoff = PromptHandoff();
      for (var index = 0; index <= PromptHandoff.limit; index++) {
        handoff.leave(SessionRef(backend: BackendId.pi, sessionId: 's$index'), [
          prompt('p$index', const PromptNotSent('no')),
        ]);
      }
      expect(
        handoff.take(const SessionRef(backend: BackendId.pi, sessionId: 's0')),
        isNull,
      );
      expect(
        handoff.take(
          const SessionRef(
            backend: BackendId.pi,
            sessionId: 's${PromptHandoff.limit}',
          ),
        ),
        hasLength(1),
      );
    });
  });
}
