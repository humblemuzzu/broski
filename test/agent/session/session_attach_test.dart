import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/session/session_controller.dart';
import 'package:broski/agent/session/session_link.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';

const _started = RunStartedEvent(runId: 'r1', trigger: RunTrigger.prompt);
const _notice = NoticeEvent(level: NoticeLevel.info, text: 'n');

/// Attaching (contract §12.2, core README §6): events placed by the order the
/// bridge sent them, overtaken answers, and failures that are tried again.
void main() {
  late SessionRig rig;

  setUp(() async => rig = await SessionRig.start());
  tearDown(() => rig.dispose());

  int attaches() => rig.link.sent.whereType<SessionAttachRequest>().length;

  /// A controller attached at e1/0 whose next attach the bridge holds.
  Future<SessionController> reattaching() async {
    final controller = await rig.attached();
    rig.bridge.on<SessionAttachRequest>((_) => null);
    rig.link.down();
    rig.link.up();
    await pumpEventQueue();
    return controller;
  }

  test('an event sent after a snapshot answer and read before the answer '
      'lands applies on top of it', () async {
    final controller = await reattaching();
    final request = rig.bridge.waiting<SessionAttachRequest>();
    rig.bridge.answer(snapshotAnswer(request, epoch: 'e2', lastSeq: 5));
    rig.bridge.event(sessionRef, 6, _started);
    await pumpEventQueue();
    final state = controller.current;
    expect(positionOf(state.link), const StreamPosition(epoch: 'e2', seq: 6));
    expect(state.snapshot.run?.runId, 'r1');
    controller.dispose();
  });

  test('an event sent before the answer continues the position held before '
      'it, then the answer and what follows apply', () async {
    final controller = await reattaching();
    final request = rig.bridge.waiting<SessionAttachRequest>();
    rig.bridge.event(sessionRef, 1, _notice);
    rig.bridge.answer(snapshotAnswer(request, epoch: 'e2', lastSeq: 3));
    rig.bridge.event(sessionRef, 4, _notice);
    await pumpEventQueue();
    expect(controller.current.notices, hasLength(2));
    expect(
      positionOf(controller.current.link),
      const StreamPosition(epoch: 'e2', seq: 4),
    );
    controller.dispose();
  });

  test('the answer of an overtaken attach is ignored, and what follows it '
      'is dropped until the newer answer', () async {
    final controller = await rig.attached();
    rig.bridge.on<SessionAttachRequest>((_) => null);
    final first = controller.attach();
    final second = controller.attach();
    await pumpEventQueue();
    final [overtaken, newer] = rig.bridge.unanswered
        .whereType<SessionAttachRequest>()
        .toList();
    rig.bridge.answer(snapshotAnswer(overtaken, epoch: 'e9', lastSeq: 0));
    rig.bridge.event(sessionRef, 1, _notice);
    await first;
    expect(controller.current.link, isA<LinkAttaching>());
    rig.bridge.answer(replayAnswer(newer));
    await second;
    expect(
      positionOf(controller.current.link),
      const StreamPosition(epoch: 'e1', seq: 0),
    );
    expect(
      controller.current.notices,
      isEmpty,
      reason: "seq 1 of e9 is not e1's next event",
    );
    controller.dispose();
  });

  test('a failed attach applies what it held before it says so', () async {
    final controller = await reattaching();
    final request = rig.bridge.waiting<SessionAttachRequest>();
    rig.bridge.event(sessionRef, 1, _started);
    rig.bridge.answer(errorAnswer(request, ProtocolErrorCode.internal));
    await pumpEventQueue();
    expect(controller.current.link, isA<LinkWaiting>());
    expect(positionOf(controller.current.link)?.seq, 1);
    expect(controller.current.snapshot.run?.runId, 'r1');
    controller.dispose();
  });

  test('a try a newer failed attach replaced sends nothing', () async {
    rig.bridge.on<SessionAttachRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.internal),
    );
    final controller = await rig.controller();
    rig.link.down();
    expect(controller.current.link, isA<LinkWaiting>());
    expect(
      (controller.current.link as LinkWaiting).problem,
      isNull,
      reason: 'offline, it waits for the connection',
    );
    rig.link.up();
    await pumpEventQueue();
    expect(attaches(), 2);
    await rig.clock.advance(SessionController.attachRetryWaits.first);
    expect(attaches(), 2, reason: "the first failure's try was replaced");
    await rig.clock.advance(SessionController.attachRetryWaits[1]);
    expect(attaches(), 3);
    controller.dispose();
  });

  test('an event while waiting for the connection is skipped, and replayed '
      'once attached again', () async {
    final controller = await rig.attached();
    rig.link.down();
    rig.bridge.event(sessionRef, 1, _started);
    expect(controller.current.snapshot.run, isNull);
    expect(positionOf(controller.current.link)?.seq, 0);
    rig.bridge.on<SessionAttachRequest>(replayAnswer);
    rig.link.up();
    await pumpEventQueue();
    rig.bridge.event(sessionRef, 1, _started);
    expect(controller.current.snapshot.run?.runId, 'r1');
    controller.dispose();
  });

  test('a replay of another epoch attaches afresh', () async {
    final controller = await reattaching();
    final request = rig.bridge.waiting<SessionAttachRequest>();
    rig.bridge.answer(
      SessionAttachResponse(
        requestId: request.requestId,
        capabilities: controllable,
        sync: const ReplaySync(epoch: 'other', afterSeq: 0),
      ),
    );
    await pumpEventQueue();
    final fresh = rig.bridge.waiting<SessionAttachRequest>();
    expect(fresh.requestId, isNot(request.requestId));
    expect(fresh.resume, isNull);
    controller.dispose();
  });

  test('a gap among events that arrive while attaching sends no attach of '
      'its own', () async {
    final controller = await reattaching();
    final request = rig.bridge.waiting<SessionAttachRequest>();
    rig.bridge.event(sessionRef, 1, _started);
    rig.bridge.event(sessionRef, 3, _notice);
    rig.bridge.answer(replayAnswer(request));
    await pumpEventQueue();
    expect(attaches(), 2);
    expect(controller.current.link, isA<LinkLive>());
    expect(positionOf(controller.current.link)?.seq, 1);
    controller.dispose();
  });

  test('an unreadable event while attaching attaches again once '
      'answered', () async {
    final controller = await reattaching();
    final request = rig.bridge.waiting<SessionAttachRequest>();
    rig.link.deliverRaw({
      'type': 'contract',
      'message': {
        'type': 'event',
        'envelope': {
          'session': sessionRef.toJson(),
          'seq': 1,
          'at': 1,
          'event': {'type': 'from_the_future'},
        },
      },
    });
    rig.bridge.answer(replayAnswer(request));
    await pumpEventQueue();
    expect(attaches(), 3);
    controller.dispose();
  });

  for (final code in [
    ProtocolErrorCode.internal,
    ProtocolErrorCode.unknownBackend,
    ProtocolErrorCode.invalidMessage,
  ]) {
    test(
      'an attach refused ${code.wire} is tried again after a wait',
      () async {
        rig.bridge.on<SessionAttachRequest>(
          (request) => errorAnswer(request, code, message: 'not now'),
        );
        final controller = await rig.controller();
        expect(
          controller.current.link,
          isA<LinkWaiting>().having((l) => l.problem, 'problem', 'not now'),
        );
        rig.bridge.on<SessionAttachRequest>(snapshotAnswer);
        await rig.clock.advance(SessionController.attachRetryWaits.first);
        expect(controller.current.link, isA<LinkLive>());
        controller.dispose();
      },
    );
  }

  test('an attach that is never answered, or whose answer cannot be read, '
      'is tried again', () async {
    rig.bridge.on<SessionAttachRequest>((_) => null);
    final controller = await rig.controller();
    await rig.clock.advance(ContractClient.answerDeadline);
    expect(controller.current.link, isA<LinkWaiting>());
    rig.bridge.on<SessionAttachRequest>(
      (request) => SessionDetachResponse(requestId: request.requestId),
    );
    await rig.clock.advance(SessionController.attachRetryWaits.first);
    expect(
      (controller.current.link as LinkWaiting).problem,
      contains('cannot read'),
    );
    rig.bridge.on<SessionAttachRequest>(snapshotAnswer);
    await rig.clock.advance(SessionController.attachRetryWaits[1]);
    expect(controller.current.link, isA<LinkLive>());
    controller.dispose();
  });

  test('the waits between tries grow, and a new connection attaches at '
      'once', () async {
    rig.bridge.on<SessionAttachRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.internal),
    );
    final controller = await rig.controller();
    await rig.clock.advance(SessionController.attachRetryWaits[0]);
    expect(attaches(), 2);
    await rig.clock.advance(
      SessionController.attachRetryWaits[1] - const Duration(seconds: 1),
    );
    expect(attaches(), 2, reason: 'the second wait is longer');
    rig.bridge.on<SessionAttachRequest>(snapshotAnswer);
    rig.link.down();
    rig.link.up();
    await pumpEventQueue();
    expect(attaches(), 3);
    expect(controller.current.link, isA<LinkLive>());
    await rig.clock.advance(const Duration(minutes: 1));
    expect(attaches(), 3, reason: 'the pending try was dropped');
    controller.dispose();
  });

  test('a disposed session leaves no wait behind', () async {
    rig.bridge.on<SessionAttachRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.internal),
    );
    final controller = await rig.controller();
    expect(rig.clock.pending, 1, reason: 'the next try');
    controller.dispose();
    expect(rig.clock.pending, 0);
  });

  test('a session the bridge no longer knows is lost for good', () async {
    rig.bridge.on<SessionAttachRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.unknownSession),
    );
    final controller = await rig.controller();
    expect(controller.current.link, isA<LinkLost>());
    await rig.clock.advance(const Duration(minutes: 1));
    rig.link.down();
    rig.link.up();
    await pumpEventQueue();
    expect(attaches(), 1);
    controller.dispose();
  });

  test('a session deleted while attaching stays lost when the attach '
      'answers', () async {
    final controller = await reattaching();
    final request = rig.bridge.waiting<SessionAttachRequest>();
    rig.bridge.catalog(
      BackendId.pi,
      const SessionRemovedEvent(session: sessionRef),
    );
    rig.bridge.answer(snapshotAnswer(request));
    await pumpEventQueue();
    expect(controller.current.link, isA<LinkLost>());
    controller.dispose();
  });
}
