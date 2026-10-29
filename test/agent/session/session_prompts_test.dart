import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/session/prompt_desk.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';

const _draft = PromptDraft(mode: PromptMode.start, text: 'Fix it');

PromptResponse _accepted(
  PromptRequest request,
  PromptDisposition disposition, {
  String? queueItemId,
}) => PromptResponse(
  requestId: request.requestId,
  result: PromptAccepted(disposition: disposition, queueItemId: queueItemId),
);

PromptResponse _refused(PromptRequest request) => PromptResponse(
  requestId: request.requestId,
  result: const Rejected(
    rejection: Rejection(code: RejectionCode.busy, message: 'A run is on'),
  ),
);

/// Prompts per contract §10: shown at once, running only once taken, rolled
/// back when refused, sent again with the same id when their fate is unknown.
void main() {
  late SessionRig rig;

  setUp(() async => rig = await SessionRig.start());
  tearDown(() => rig.dispose());

  test('shows at once, runs only once taken, leaves when echoed', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>((_) => null);
    final sending = controller.prompts.send(_draft);
    final shown = controller.current.prompts.single;
    expect(shown.delivery, isA<PromptSending>());
    expect(shown.input.text, 'Fix it');
    expect(controller.current.running, isFalse);
    await pumpEventQueue();
    final request = rig.bridge.waiting<PromptRequest>();
    expect(request.input.clientRequestId, shown.clientRequestId);
    rig.bridge.answer(_accepted(request, PromptDisposition.started));
    await sending;
    expect(controller.current.running, isTrue);
    rig.bridge.event(
      sessionRef,
      1,
      const RunStartedEvent(runId: 'r1', trigger: RunTrigger.prompt),
    );
    rig.bridge.event(
      sessionRef,
      2,
      UserMessageEvent(
        messageId: 'u1',
        text: 'Fix it',
        attachments: const [],
        clientRequestId: shown.clientRequestId,
      ),
    );
    expect(controller.current.prompts, isEmpty);
    expect(controller.current.snapshot.run?.items.single.id, 'u1');
    controller.dispose();
  });

  test('a refusal rolls it back; a retry keeps its id', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(_refused);
    await controller.prompts.send(_draft);
    final refused = controller.current.prompts.single;
    expect(
      refused.delivery,
      isA<PromptNotSent>().having((d) => d.reason, 'reason', 'A run is on'),
    );
    expect(controller.current.running, isFalse);
    rig.bridge.on<PromptRequest>(
      (request) => _accepted(request, PromptDisposition.started),
    );
    await controller.prompts.retry(refused.clientRequestId);
    final retried = rig.link.sent.whereType<PromptRequest>().toList();
    expect(retried, hasLength(2));
    expect(retried.last.input, retried.first.input);
    expect(controller.current.prompts.single.delivery, isA<PromptTaken>());
    controller.dispose();
  });

  test('a refused prompt can be taken back to edit', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(_refused);
    await controller.prompts.send(_draft);
    final id = controller.current.prompts.single.clientRequestId;
    expect(controller.prompts.withdraw(id)?.text, 'Fix it');
    expect(controller.current.prompts, isEmpty);
    controller.dispose();
  });

  test('a prompt lost with the connection is sent again, with the same id, '
      'once attached again', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>((_) => null);
    final sending = controller.prompts.send(_draft);
    await pumpEventQueue();
    rig.link.down();
    await sending;
    expect(
      controller.current.prompts.single.delivery,
      isA<PromptUnconfirmed>(),
    );
    rig.bridge.on<SessionAttachRequest>(replayAnswer);
    rig.bridge.on<PromptRequest>(
      (request) => _accepted(request, PromptDisposition.started),
    );
    rig.link.up();
    await pumpEventQueue();
    final sent = rig.link.sent.whereType<PromptRequest>().toList();
    expect(sent, hasLength(2));
    expect(sent.last.input.clientRequestId, sent.first.input.clientRequestId);
    expect(controller.current.prompts.single.delivery, isA<PromptTaken>());
    controller.dispose();
  });

  test('a prompt that ran while the phone was away leaves once the history '
      'shows it, and does not keep the session running', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>((_) => null);
    final sending = controller.prompts.send(_draft);
    await pumpEventQueue();
    final id = controller.current.prompts.single.clientRequestId;
    rig.link.down();
    await sending;
    rig.bridge.on<SessionAttachRequest>(
      (request) => snapshotAnswer(request, epoch: 'e2'),
    );
    rig.bridge.on<TranscriptReadRequest>(
      (request) => pageAnswer(request, [userItem('u1', clientRequestId: id)]),
    );
    rig.bridge.on<PromptRequest>(
      (request) => _accepted(request, PromptDisposition.started),
    );
    rig.link.up();
    await pumpEventQueue();
    expect(controller.current.prompts, isEmpty);
    expect(controller.current.running, isFalse);
    controller.dispose();
  });

  test('a prompt the backend handled without a run leaves at once', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) => _accepted(request, PromptDisposition.handled),
    );
    await controller.prompts.send(_draft);
    expect(controller.current.prompts, isEmpty);
    controller.dispose();
  });

  test('a queued prompt waits; cancelling it removes it', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) =>
          _accepted(request, PromptDisposition.queued, queueItemId: 'q1'),
    );
    await controller.prompts.send(
      const PromptDraft(mode: PromptMode.queue, text: 'Later'),
    );
    expect(controller.current.prompts.single.delivery, isA<PromptTaken>());
    rig.bridge.on<QueueCancelRequest>(
      (request) => QueueCancelResponse(
        requestId: request.requestId,
        result: const ActionAccepted(),
      ),
    );
    await controller.controls.cancelQueued('q1');
    expect(controller.current.prompts, isEmpty);
    controller.dispose();
  });

  test('at the end of a run, a taken prompt that never echoed leaves, '
      'and one still queued stays', () async {
    final controller = await rig.attached();
    rig.bridge.event(
      sessionRef,
      1,
      const RunStartedEvent(runId: 'r1', trigger: RunTrigger.prompt),
    );
    rig.bridge.on<PromptRequest>(
      (request) => request.input.mode == PromptMode.steer
          ? _accepted(request, PromptDisposition.steered)
          : _accepted(request, PromptDisposition.queued, queueItemId: 'q1'),
    );
    await controller.prompts.send(
      const PromptDraft(mode: PromptMode.steer, text: 'Also'),
    );
    await controller.prompts.send(
      const PromptDraft(mode: PromptMode.queue, text: 'Then'),
    );
    rig.bridge.event(
      sessionRef,
      2,
      const QueueChangedEvent(
        items: [
          QueueItem(id: 'q1', delivery: QueuedDelivery.queue, preview: 'Then'),
        ],
      ),
    );
    rig.bridge.event(
      sessionRef,
      3,
      const RunFinishedEvent(runId: 'r1', outcome: RunCompleted()),
    );
    expect(controller.current.prompts.single.input.text, 'Then');
    controller.dispose();
  });
}
