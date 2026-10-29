import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/session/prompt_desk.dart';
import 'package:broski/agent/session/session_controller.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';

const _draft = PromptDraft(mode: PromptMode.start, text: 'Fix it');

PromptResponse _started(PromptRequest request) => PromptResponse(
  requestId: request.requestId,
  result: const PromptAccepted(disposition: PromptDisposition.started),
);

/// A prompt whose answer did not come (contract §10, §12.1): sent again with
/// the same `clientRequestId` when the phone can, left to the person when it
/// cannot, and never lost.
void main() {
  late SessionRig rig;

  setUp(() async => rig = await SessionRig.start());
  tearDown(() => rig.dispose());

  List<PromptRequest> sent() =>
      rig.link.sent.whereType<PromptRequest>().toList();

  PromptDelivery delivery(SessionController controller) =>
      controller.current.prompts.single.delivery;

  Matcher unconfirmed({required bool resending}) => isA<PromptUnconfirmed>()
      .having((d) => d.resending, 'resending', resending);

  void expectSameId() {
    final ids = {for (final request in sent()) request.input.clientRequestId};
    expect(ids, hasLength(1));
  }

  test('one refused internal is sent again after a wait', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.internal),
    );
    await controller.prompts.send(_draft);
    expect(delivery(controller), unconfirmed(resending: true));
    rig.bridge.on<PromptRequest>(_started);
    await rig.clock.advance(PromptDesk.resendWaits.first);
    expect(delivery(controller), isA<PromptTaken>());
    expectSameId();
    controller.dispose();
  });

  test('one still rate_limited after the client\'s own retries is sent again '
      'after a wait', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.rateLimited),
    );
    final sending = controller.prompts.send(_draft);
    await pumpEventQueue();
    for (final wait in ContractClient.rateLimitWaits) {
      expect(delivery(controller), isA<PromptSending>());
      await rig.clock.advance(wait);
    }
    await sending;
    expect(delivery(controller), unconfirmed(resending: true));
    rig.bridge.on<PromptRequest>(_started);
    await rig.clock.advance(PromptDesk.resendWaits.first);
    expect(delivery(controller), isA<PromptTaken>());
    expect(sent(), hasLength(ContractClient.rateLimitWaits.length + 2));
    expectSameId();
    controller.dispose();
  });

  test('one whose answer never came is sent again after a wait', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>((_) => null);
    final sending = controller.prompts.send(_draft);
    await pumpEventQueue();
    await rig.clock.advance(ContractClient.answerDeadline);
    await sending;
    expect(delivery(controller), unconfirmed(resending: true));
    rig.bridge.on<PromptRequest>(_started);
    await rig.clock.advance(PromptDesk.resendWaits.first);
    expect(delivery(controller), isA<PromptTaken>());
    expectSameId();
    controller.dispose();
  });

  test('one refused not_attached attaches again, then is sent again', () async {
    final controller = await rig.attached();
    rig.bridge.on<SessionAttachRequest>((_) => null);
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.notAttached),
    );
    await controller.prompts.send(_draft);
    await pumpEventQueue();
    expect(delivery(controller), unconfirmed(resending: true));
    final reattach = rig.bridge.waiting<SessionAttachRequest>();
    expect(reattach.resume, const StreamPosition(epoch: 'e1', seq: 0));
    rig.bridge.on<PromptRequest>(_started);
    rig.bridge.answer(replayAnswer(reattach));
    await pumpEventQueue();
    expect(delivery(controller), isA<PromptTaken>());
    expectSameId();
    controller.dispose();
  });

  test('after the last wait it waits for the person, who can send it '
      'again', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.internal),
    );
    await controller.prompts.send(_draft);
    for (final wait in PromptDesk.resendWaits) {
      expect(delivery(controller), unconfirmed(resending: true));
      await rig.clock.advance(wait);
    }
    expect(delivery(controller), unconfirmed(resending: false));
    final tries = sent().length;
    expect(tries, PromptDesk.resendWaits.length + 1);
    await rig.clock.advance(const Duration(minutes: 5));
    expect(sent(), hasLength(tries), reason: 'nothing more on its own');
    final id = controller.current.prompts.single.clientRequestId;
    await controller.prompts.retry(id);
    expect(
      delivery(controller),
      unconfirmed(resending: true),
      reason: 'a retry by the person starts the waits afresh',
    );
    rig.bridge.on<PromptRequest>(_started);
    await rig.clock.advance(PromptDesk.resendWaits.first);
    expect(delivery(controller), isA<PromptTaken>());
    expectSameId();
    controller.dispose();
  });

  test('Send again by the person, mid-way, starts the waits afresh', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.internal),
    );
    await controller.prompts.send(_draft);
    await rig.clock.advance(PromptDesk.resendWaits.first);
    expect(sent(), hasLength(2), reason: 'the first automatic resend');
    await controller.prompts.retry(
      controller.current.prompts.single.clientRequestId,
    );
    expect(sent(), hasLength(3));
    await rig.clock.advance(PromptDesk.resendWaits.first);
    expect(
      sent(),
      hasLength(4),
      reason: 'the first wait again, not the second',
    );
    controller.dispose();
  });

  test('a wait a newer one replaced sends nothing', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.internal),
    );
    await controller.prompts.send(_draft);
    rig.bridge.on<SessionAttachRequest>(replayAnswer);
    rig.link.down();
    rig.link.up();
    await pumpEventQueue();
    expect(sent(), hasLength(2), reason: 'sent again once attached');
    await rig.clock.advance(PromptDesk.resendWaits.first);
    expect(sent(), hasLength(2), reason: 'the first wait no longer counts');
    await rig.clock.advance(PromptDesk.resendWaits[1]);
    expect(sent(), hasLength(3));
    controller.dispose();
  });

  test('a wait that ends after the session was deleted leaves it to the '
      'person', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.internal),
    );
    await controller.prompts.send(_draft);
    rig.bridge.catalog(
      BackendId.pi,
      const SessionRemovedEvent(session: sessionRef),
    );
    await rig.clock.advance(PromptDesk.resendWaits.first);
    expect(delivery(controller), unconfirmed(resending: false));
    expect(sent(), hasLength(1));
    controller.dispose();
  });

  test('not_attached while an attach is out waits for that attach', () async {
    final controller = await rig.attached();
    rig.bridge.on<SessionAttachRequest>((_) => null);
    rig.link.down();
    rig.link.up();
    await pumpEventQueue();
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.notAttached),
    );
    await controller.prompts.send(_draft);
    await pumpEventQueue();
    expect(rig.link.sent.whereType<SessionAttachRequest>(), hasLength(2));
    rig.bridge.on<PromptRequest>(_started);
    rig.bridge.answer(replayAnswer(rig.bridge.waiting<SessionAttachRequest>()));
    await pumpEventQueue();
    expect(delivery(controller), isA<PromptTaken>());
    controller.dispose();
  });

  test('while it waits it can be taken back to edit', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.internal),
    );
    await controller.prompts.send(_draft);
    final id = controller.current.prompts.single.clientRequestId;
    expect(controller.prompts.withdraw(id)?.text, 'Fix it');
    expect(controller.current.prompts, isEmpty);
    await rig.clock.advance(const Duration(minutes: 1));
    expect(sent(), hasLength(1), reason: 'a withdrawn prompt is not resent');
    controller.dispose();
  });

  test('a wait that ends while the connection is down leaves the resend to '
      'the attach that follows', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.internal),
    );
    await controller.prompts.send(_draft);
    rig.link.down();
    await rig.clock.advance(PromptDesk.resendWaits.first);
    expect(sent(), hasLength(1));
    rig.bridge.on<SessionAttachRequest>(replayAnswer);
    rig.bridge.on<PromptRequest>(_started);
    rig.link.up();
    await pumpEventQueue();
    expect(sent(), hasLength(2));
    expect(delivery(controller), isA<PromptTaken>());
    controller.dispose();
  });

  test('an unreadable answer leaves it to the person; a refusal to read the '
      'request means it was not sent', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) => SessionDetachResponse(requestId: request.requestId),
    );
    await controller.prompts.send(_draft);
    expect(delivery(controller), unconfirmed(resending: false));
    final id = controller.current.prompts.single.clientRequestId;
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.invalidMessage),
    );
    await controller.prompts.retry(id);
    expect(delivery(controller), isA<PromptNotSent>());
    controller.dispose();
  });

  test('one the link refused to carry was not sent', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>((_) => null);
    final sending = controller.prompts.send(_draft);
    await pumpEventQueue();
    rig.link.refuse(rig.bridge.waiting<PromptRequest>().requestId);
    await sending;
    expect(delivery(controller), isA<PromptNotSent>());
    await rig.clock.advance(const Duration(minutes: 1));
    expect(sent(), hasLength(1));
    controller.dispose();
  });

  test('session_replaced hands the prompts the person still owns to the '
      'session that goes on', () async {
    final controller = await rig.attached();
    rig.bridge.on<PromptRequest>(
      (request) => request.input.text == 'refused'
          ? PromptResponse(
              requestId: request.requestId,
              result: const Rejected(
                rejection: Rejection(code: RejectionCode.busy, message: 'busy'),
              ),
            )
          : null,
    );
    await controller.prompts.send(
      const PromptDraft(mode: PromptMode.start, text: 'refused'),
    );
    controller.prompts.send(_draft).ignore();
    await pumpEventQueue();
    const next = SessionRef(backend: BackendId.pi, sessionId: 's2');
    rig.bridge.event(sessionRef, 1, const SessionReplacedEvent(session: next));
    expect(controller.current.prompts, isEmpty);
    final successor = await rig.controller(session: next);
    final carried = successor.current.prompts;
    expect(carried.map((p) => p.input.text), ['refused', 'Fix it']);
    expect(carried.first.delivery, isA<PromptNotSent>());
    expect(carried.last.delivery, unconfirmed(resending: false));
    controller.dispose();
    successor.dispose();
  });
}
