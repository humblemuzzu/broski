import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/session/prompt_desk.dart';
import 'package:broski/agent/session/session_controller.dart';
import 'package:broski/agent/session/session_link.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';

const _next = SessionRef(backend: BackendId.pi, sessionId: 's2');
const _draft = PromptDraft(mode: PromptMode.start, text: 'Fix it');

SessionAttachResponse _replacedAnswer(SessionAttachRequest request) =>
    SessionAttachResponse(
      requestId: request.requestId,
      capabilities: controllable,
      sync: const ReplacedSync(epoch: 'e1', session: _next),
    );

/// A session replaced while the phone was away (contract §5, §12.2): the
/// bridge answers the reattach with the session the conversation went on as.
void main() {
  late SessionRig rig;

  setUp(() async => rig = await SessionRig.start());
  tearDown(() => rig.dispose());

  int attaches() => rig.link.sent.whereType<SessionAttachRequest>().length;

  Future<SessionController> reconnectedAfterReplacement() async {
    final controller = await rig.attached();
    rig.link.down();
    rig.bridge.on<SessionAttachRequest>(_replacedAnswer);
    rig.link.up();
    await pumpEventQueue();
    return controller;
  }

  test('a reconnect answered "replaced" with the session itself attaches it '
      'afresh', () async {
    final controller = await rig.attached();
    rig.link.down();
    rig.bridge.on<SessionAttachRequest>(
      (request) => request.resume == null
          ? snapshotAnswer(request)
          : SessionAttachResponse(
              requestId: request.requestId,
              capabilities: controllable,
              sync: const ReplacedSync(epoch: 'e1', session: sessionRef),
            ),
    );
    rig.link.up();
    await pumpEventQueue();
    expect(controller.current.link, isA<LinkLive>());
    expect(rig.link.last<SessionAttachRequest>().resume, isNull);
    controller.dispose();
  });

  test('a reconnect answered "replaced" follows the conversation and attaches '
      'to nothing', () async {
    final controller = await reconnectedAfterReplacement();
    expect(
      controller.current.link,
      isA<LinkReplaced>().having((link) => link.next, 'next', _next),
    );
    expect(attaches(), 2, reason: 'the first attach and the reconnect');
    await rig.clock.advance(const Duration(minutes: 5));
    expect(attaches(), 2, reason: 'nothing is tried again');
    controller.dispose();
    await pumpEventQueue();
    expect(rig.link.sent.whereType<SessionDetachRequest>(), isEmpty);
  });

  test('the prompts typed while away leave for the next session, which says '
      'the conversation moved', () async {
    final controller = await rig.attached();
    rig.link.down();
    await controller.prompts.send(_draft);
    expect(controller.current.prompts, hasLength(1));
    rig.bridge.on<SessionAttachRequest>(_replacedAnswer);
    rig.link.up();
    await pumpEventQueue();
    expect(controller.current.prompts, isEmpty);

    rig.bridge.on<SessionAttachRequest>(snapshotAnswer);
    final following = await rig.controller(session: _next);
    final prompt = following.current.prompts.single;
    expect(prompt.input.text, 'Fix it');
    expect(
      prompt.delivery,
      isA<PromptUnconfirmed>().having(
        (delivery) => delivery.resending,
        'resending',
        isFalse,
      ),
      reason: 'the bridge de-duplicates by session: the person decides',
    );
    expect(following.current.notices.single.level, NoticeLevel.info);
    expect(
      following.current.notices.single.text,
      'This conversation continued in a new session',
    );
    controller.dispose();
    following.dispose();
  });

  test('an attach that was never answered before the replacement is told too, '
      'and nothing is lost for want of a prompt', () async {
    rig.bridge.on<SessionAttachRequest>(_replacedAnswer);
    final controller = await rig.controller();
    expect(controller.current.link, isA<LinkReplaced>());
    rig.bridge.on<SessionAttachRequest>(snapshotAnswer);
    final following = await rig.controller(session: _next);
    expect(following.current.prompts, isEmpty);
    expect(following.current.notices, hasLength(1));
    controller.dispose();
    following.dispose();
  });

  test('events that came before the answer apply first; those after it, which '
      'belong to a sync never applied, are dropped', () async {
    final controller = await rig.attached();
    rig.link.down();
    rig.bridge.on<SessionAttachRequest>((_) => null);
    rig.link.up();
    await pumpEventQueue();
    expect(controller.current.link, isA<LinkAttaching>());
    const notice = NoticeEvent(level: NoticeLevel.info, text: 'before');
    rig.bridge.event(sessionRef, 1, notice);
    rig.bridge.answer(
      _replacedAnswer(rig.bridge.waiting<SessionAttachRequest>()),
    );
    rig.bridge.event(sessionRef, 2, notice);
    await pumpEventQueue();
    expect(controller.current.link, isA<LinkReplaced>());
    expect(controller.current.notices.map((shown) => shown.text), ['before']);
    controller.dispose();
  });

  test('the live event and the answer to a reattach lead to the same place: '
      'a session reached either way shows the notice', () async {
    final controller = await rig.attached();
    rig.bridge.event(sessionRef, 1, const SessionReplacedEvent(session: _next));
    rig.bridge.on<SessionAttachRequest>(snapshotAnswer);
    final following = await rig.controller(session: _next);
    expect(following.current.notices, hasLength(1));
    expect(
      controller.current.link,
      isA<LinkReplaced>().having((link) => link.next, 'next', _next),
    );
    controller.dispose();
    following.dispose();
  });

  test('a session no replacement led to shows no notice', () async {
    final controller = await rig.attached();
    expect(controller.current.notices, isEmpty);
    controller.dispose();
  });
}
