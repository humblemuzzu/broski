import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';

const _choice = Interaction(
  id: 'i1',
  runId: 'r1',
  createdAt: 1,
  title: 'Pick',
  blocksRun: true,
  request: ChoiceRequest(
    options: [Option(value: 'a', label: 'A')],
  ),
);

InteractionAnswerResponse _answered(
  InteractionAnswerRequest request, {
  Rejection? rejection,
}) => InteractionAnswerResponse(
  requestId: request.requestId,
  result: rejection == null
      ? const ActionAccepted()
      : Rejected(rejection: rejection),
);

/// Answers per contract §9: checked on the phone first, first answer wins,
/// the ask ends only when the backend resolves it.
void main() {
  late SessionRig rig;

  setUp(() async => rig = await SessionRig.start());
  tearDown(() => rig.dispose());

  final asking = replacing(emptySnapshot(), interactions: const [_choice]);

  test('a faulted answer is refused on the phone and never sent', () async {
    final controller = await rig.attached(snapshot: asking);
    final problem = await controller.controls.answer(
      _choice,
      const ChoiceReply(value: 'z'),
    );
    expect(problem, 'not one of the options');
    expect(rig.link.sent.whereType<InteractionAnswerRequest>(), isEmpty);
    controller.dispose();
  });

  test(
    'a valid answer is sent and ends when the backend resolves it',
    () async {
      final controller = await rig.attached(snapshot: asking);
      rig.bridge.on<InteractionAnswerRequest>(_answered);
      final problem = await controller.controls.answer(
        _choice,
        const ChoiceReply(value: 'a'),
      );
      expect(problem, isNull);
      expect(controller.current.answering['i1'], isA<AnswerSending>());
      rig.bridge.event(
        sessionRef,
        1,
        const InteractionResolvedEvent(
          interactionId: 'i1',
          reason: ResolutionReason.answered,
        ),
      );
      expect(controller.current.answering, isEmpty);
      expect(controller.current.snapshot.interactions, isEmpty);
      controller.dispose();
    },
  );

  test('when another phone answered first, this one is told so', () async {
    final controller = await rig.attached(snapshot: asking);
    rig.bridge.on<InteractionAnswerRequest>(
      (request) => _answered(
        request,
        rejection: const Rejection(code: RejectionCode.stale, message: 'stale'),
      ),
    );
    await controller.controls.answer(_choice, const ChoiceReply(value: 'a'));
    expect(
      controller.current.answering['i1'],
      isA<AnswerNotTaken>().having(
        (progress) => progress.reason,
        'reason',
        'This was already answered',
      ),
    );
    controller.dispose();
  });

  test('a second answer while the first is on its way is not sent', () async {
    final controller = await rig.attached(snapshot: asking);
    rig.bridge.on<InteractionAnswerRequest>((_) => null);
    final first = controller.controls.answer(
      _choice,
      const ChoiceReply(value: 'a'),
    );
    final second = await controller.controls.answer(
      _choice,
      const CancelReply(stopRun: false),
    );
    expect(second, 'Your answer is already on its way');
    await pumpEventQueue();
    final request = rig.bridge.waiting<InteractionAnswerRequest>();
    expect(rig.link.sent.whereType<InteractionAnswerRequest>(), hasLength(1));
    rig.bridge.answer(_answered(request));
    expect(await first, isNull);
    expect(controller.current.answering['i1'], isA<AnswerSending>());
    controller.dispose();
  });

  test('a resync drops the answers to asks it no longer holds', () async {
    final controller = await rig.attached(snapshot: asking);
    rig.bridge.on<InteractionAnswerRequest>(
      (request) => _answered(
        request,
        rejection: const Rejection(code: RejectionCode.busy, message: 'busy'),
      ),
    );
    await controller.controls.answer(_choice, const ChoiceReply(value: 'a'));
    expect(controller.current.answering['i1'], isA<AnswerNotTaken>());
    rig.bridge.event(sessionRef, 1, ResyncedEvent(snapshot: emptySnapshot()));
    expect(controller.current.snapshot.interactions, isEmpty);
    expect(controller.current.answering, isEmpty);
    controller.dispose();
  });

  test('an answer to an ask that already ended is not sent', () async {
    final controller = await rig.attached();
    final problem = await controller.controls.answer(
      _choice,
      const ChoiceReply(value: 'a'),
    );
    expect(problem, isNotNull);
    expect(rig.link.sent.whereType<InteractionAnswerRequest>(), isEmpty);
    controller.dispose();
  });
}
