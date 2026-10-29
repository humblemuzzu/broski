import 'package:broski/agent/session/session_history.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';

TranscriptPage _page(
  List<String> newestFirst, {
  String? next,
  IdStability stability = IdStability.stable,
}) => TranscriptPage(
  items: [for (final id in newestFirst) userItem(id)],
  nextCursor: next,
  idStability: stability,
);

List<String> _ids(SessionHistory history) => [
  for (final item in history.items) item.id,
];

/// The merge rule of contract §8: finished runs from transcript pages, newest
/// first; the live run from the snapshot; no duplicate, no gap.
void main() {
  group('a newest page', () {
    test('starts the history, oldest first', () {
      final history = const SessionHistory().withNewestPage(
        _page(['c', 'b'], next: 'older'),
      );
      expect(_ids(history), ['b', 'c']);
      expect(history.olderCursor, 'older');
      expect(history.complete, isFalse);
      expect(history.loaded, isTrue);
    });

    test('with stable ids, keeps older pages where it begins in them', () {
      final read = const SessionHistory()
          .withNewestPage(_page(['d', 'c'], next: 'p2'))
          .withOlderPage(_page(['b', 'a'], next: 'p3'));
      final again = read.withNewestPage(_page(['e', 'd', 'c'], next: 'x'));
      expect(_ids(again), ['a', 'b', 'c', 'd', 'e']);
      expect(again.olderCursor, 'p3', reason: 'older pages stay paged');
    });

    test('starts afresh when it begins in none of the pages held', () {
      final read = const SessionHistory().withNewestPage(_page(['b', 'a']));
      final again = read.withNewestPage(_page(['z', 'y'], next: 'n'));
      expect(_ids(again), ['y', 'z']);
      expect(again.olderCursor, 'n');
    });

    test('starts afresh with positional ids, or after a rewrite', () {
      final read = const SessionHistory()
          .withNewestPage(_page(['d', 'c'], next: 'p2'))
          .withOlderPage(_page(['b', 'a']));
      final positional = read.withNewestPage(
        _page(['d', 'c'], stability: IdStability.positional),
      );
      expect(_ids(positional), ['c', 'd']);
      final rewritten = read.withNewestPage(_page(['d', 'c']), rewritten: true);
      expect(_ids(rewritten), ['c', 'd']);
    });

    test('replaces the items of runs that settled', () {
      const run = ActiveRun(
        runId: 'r1',
        trigger: RunTrigger.prompt,
        startedAt: 1,
        items: [UserMessageItem(id: 'live', text: 'x', attachments: [])],
        droppedItems: 3,
      );
      final settled = const SessionHistory().withSettledRun(run);
      expect(settled.settling, run.items);
      expect(settled.settlingDropped, 3);
      final read = settled.withNewestPage(_page(['t']));
      expect(read.settling, isEmpty);
      expect(read.settlingDropped, 0);
    });
  });

  test('an older page never shows a row twice when ids are stable', () {
    final history = const SessionHistory()
        .withNewestPage(_page(['c', 'b'], next: 'p2'))
        .withOlderPage(_page(['b', 'a']));
    expect(_ids(history), ['a', 'b', 'c']);
    expect(history.complete, isTrue);
  });

  group('in a session', () {
    late SessionRig rig;

    setUp(() async => rig = await SessionRig.start());
    tearDown(() => rig.dispose());

    test('a finished run stays shown until the newest page replaces it, '
        'and an overtaken read never lands', () async {
      final controller = await rig.attached();
      rig.bridge.on<TranscriptReadRequest>((_) => null);
      rig.bridge.event(
        sessionRef,
        1,
        const RunStartedEvent(runId: 'r1', trigger: RunTrigger.prompt),
      );
      rig.bridge.event(
        sessionRef,
        2,
        const UserMessageEvent(messageId: 'm1', text: 'go', attachments: []),
      );
      rig.bridge.event(
        sessionRef,
        3,
        const RunFinishedEvent(runId: 'r1', outcome: RunCompleted()),
      );
      expect(controller.current.history.settling.single.id, 'm1');
      await pumpEventQueue();
      final first = rig.bridge.waiting<TranscriptReadRequest>();
      rig.bridge.catalog(
        BackendId.pi,
        const TranscriptInvalidatedEvent(session: sessionRef),
      );
      await pumpEventQueue();
      final second = rig.bridge.waiting<TranscriptReadRequest>();
      rig.bridge.answer(pageAnswer(second, [userItem('t1')]));
      rig.bridge.answer(pageAnswer(first, [userItem('stale')]));
      await pumpEventQueue();
      final history = controller.current.history;
      expect(_ids(history), ['t1']);
      expect(history.settling, isEmpty);
      controller.dispose();
    });

    test('older pages load on demand', () async {
      rig.bridge.on<SessionAttachRequest>(snapshotAnswer);
      rig.bridge.on<TranscriptReadRequest>(
        (request) => request.page.cursor == null
            ? pageAnswer(request, [userItem('b')], nextCursor: 'p2')
            : pageAnswer(request, [userItem('a')]),
      );
      final controller = await rig.controller();
      await controller.history.loadOlder();
      expect(_ids(controller.current.history), ['a', 'b']);
      expect(controller.current.history.complete, isTrue);
      controller.dispose();
    });
  });
}
