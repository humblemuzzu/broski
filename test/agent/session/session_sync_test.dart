import 'package:broski/agent/session/session_link.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';

const _started = RunStartedEvent(runId: 'r1', trigger: RunTrigger.prompt);
const _notice = NoticeEvent(level: NoticeLevel.info, text: 'n');

/// Attach, `seq` order, gaps, replay and snapshot: contract §7, §12.2.
void main() {
  late SessionRig rig;

  setUp(() async => rig = await SessionRig.start());
  tearDown(() => rig.dispose());

  test(
    'attaches when ready, live from the snapshot, with its history',
    () async {
      final controller = await rig.attached();
      final state = controller.current;
      expect(positionOf(state.link), const StreamPosition(epoch: 'e1', seq: 0));
      expect(state.link, isA<LinkLive>());
      expect(state.capabilities, controllable);
      expect(state.history.loaded, isTrue);
      expect(state.summary, summary);
      controller.dispose();
    },
  );

  test('applies events in seq order and skips one already applied', () async {
    final controller = await rig.attached();
    rig.bridge.event(sessionRef, 1, _notice);
    rig.bridge.event(sessionRef, 1, _notice);
    rig.bridge.event(sessionRef, 2, _started);
    await pumpEventQueue();
    expect(controller.current.snapshot.run?.runId, 'r1');
    expect(controller.current.notices, hasLength(1));
    expect(positionOf(controller.current.link)?.seq, 2);
    expect(
      rig.link.sent.whereType<SessionAttachRequest>(),
      hasLength(1),
      reason: 'a repeat is no gap',
    );
    controller.dispose();
  });

  test(
    'a gap reattaches from the last event applied, and the replay goes on',
    () async {
      final controller = await rig.attached();
      rig.bridge.event(sessionRef, 1, _started);
      rig.bridge.on<SessionAttachRequest>((_) => null);
      rig.bridge.event(sessionRef, 3, _notice);
      await pumpEventQueue();
      final reattach = rig.bridge.waiting<SessionAttachRequest>();
      expect(reattach.resume, const StreamPosition(epoch: 'e1', seq: 1));
      expect(controller.current.notices, isEmpty, reason: 'seq 3 not applied');
      rig.bridge.answer(replayAnswer(reattach));
      rig.bridge.event(sessionRef, 2, _notice);
      rig.bridge.event(sessionRef, 3, _notice);
      await pumpEventQueue();
      expect(controller.current.link, isA<LinkLive>());
      expect(controller.current.notices, hasLength(2));
      controller.dispose();
    },
  );

  test('a reconnect resumes with a replay of what was missed', () async {
    final controller = await rig.attached();
    rig.bridge.event(sessionRef, 1, _started);
    rig.link.down();
    expect(controller.current.link, isA<LinkWaiting>());
    rig.bridge.on<SessionAttachRequest>(replayAnswer);
    rig.link.up();
    await pumpEventQueue();
    final reattach = rig.link.last<SessionAttachRequest>();
    expect(reattach.resume, const StreamPosition(epoch: 'e1', seq: 1));
    rig.bridge.event(sessionRef, 2, _notice);
    expect(controller.current.notices, hasLength(1));
    expect(controller.current.snapshot.run?.runId, 'r1');
    controller.dispose();
  });

  test(
    'a reconnect to a new stream takes its snapshot and reads history again',
    () async {
      final controller = await rig.attached();
      rig.bridge.event(sessionRef, 1, _started);
      rig.link.down();
      final reads = rig.link.sent.whereType<TranscriptReadRequest>().length;
      rig.bridge.on<SessionAttachRequest>(
        (request) => snapshotAnswer(request, epoch: 'e2', lastSeq: 7),
      );
      rig.link.up();
      await pumpEventQueue();
      final state = controller.current;
      expect(positionOf(state.link), const StreamPosition(epoch: 'e2', seq: 7));
      expect(
        state.snapshot.run,
        isNull,
        reason: 'the new snapshot replaced it',
      );
      expect(
        rig.link.sent.whereType<TranscriptReadRequest>(),
        hasLength(reads + 1),
      );
      controller.dispose();
    },
  );

  test('events that arrive while attaching wait for the answer, then apply '
      'in the order they were sent', () async {
    final controller = await rig.attached();
    rig.bridge.on<SessionAttachRequest>((_) => null);
    rig.link.down();
    rig.link.up();
    await pumpEventQueue();
    expect(controller.current.link, isA<LinkAttaching>());
    rig.bridge.event(sessionRef, 1, _started);
    expect(controller.current.snapshot.run, isNull, reason: 'held');
    rig.bridge.answer(replayAnswer(rig.bridge.waiting<SessionAttachRequest>()));
    await pumpEventQueue();
    expect(controller.current.snapshot.run?.runId, 'r1');
    rig.bridge.event(sessionRef, 1, _started);
    rig.bridge.event(sessionRef, 2, _notice);
    expect(positionOf(controller.current.link)?.seq, 2);
    expect(controller.current.notices, hasLength(1));
    controller.dispose();
  });

  test('an attach lost with the connection resumes from what was applied '
      'while it was out, so nothing applies twice', () async {
    final controller = await rig.attached();
    rig.bridge.on<SessionAttachRequest>((_) => null);
    rig.link.down();
    rig.link.up();
    await pumpEventQueue();
    rig.bridge.event(sessionRef, 1, _started);
    rig.link.down();
    await pumpEventQueue();
    expect(positionOf(controller.current.link)?.seq, 1);
    rig.bridge.on<SessionAttachRequest>(replayAnswer);
    rig.link.up();
    await pumpEventQueue();
    expect(rig.link.last<SessionAttachRequest>().resume?.seq, 1);
    rig.bridge.event(sessionRef, 1, _started);
    rig.bridge.event(sessionRef, 2, _notice);
    expect(controller.current.notices, hasLength(1));
    controller.dispose();
  });

  test('session_replaced hands the conversation to the next session', () async {
    final controller = await rig.attached();
    const next = SessionRef(backend: BackendId.pi, sessionId: 's2');
    rig.bridge.event(sessionRef, 1, const SessionReplacedEvent(session: next));
    expect(
      controller.current.link,
      isA<LinkReplaced>().having((link) => link.next, 'next', next),
    );
    controller.dispose();
  });

  test('an unknown session is lost', () async {
    rig.bridge.on<SessionAttachRequest>(
      (request) => ErrorResponse(
        requestId: request.requestId,
        error: const ProtocolError(
          code: ProtocolErrorCode.unknownSession,
          message: 'gone',
        ),
      ),
    );
    final controller = await rig.controller();
    expect(controller.current.link, isA<LinkLost>());
    controller.dispose();
  });

  test('a deleted session is lost', () async {
    final controller = await rig.attached();
    rig.bridge.catalog(
      BackendId.pi,
      const SessionRemovedEvent(session: sessionRef),
    );
    expect(controller.current.link, isA<LinkLost>());
    controller.dispose();
  });

  test(
    'a row update reaches the session; a detach goes out on dispose',
    () async {
      final controller = await rig.attached();
      const renamed = SessionSummary(
        session: sessionRef,
        title: SessionTitle(text: 'Renamed', source: TitleSource.user),
        updatedAt: 2,
        archived: false,
        status: SessionStatus.running,
        origin: SessionOrigin.broski,
      );
      rig.bridge.catalog(
        BackendId.pi,
        const SessionUpdatedEvent(summary: renamed),
      );
      expect(controller.current.summary, renamed);
      controller.dispose();
      await pumpEventQueue();
      expect(rig.link.sent.last, isA<SessionDetachRequest>());
    },
  );
}
