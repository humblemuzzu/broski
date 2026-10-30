import 'package:broski/agent/cache/agent_cache.dart';
import 'package:broski/agent/cache/cached_kinds.dart';
import 'package:broski/agent/session/session_controller.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/memory_text_store.dart';
import '../support/session_fixtures.dart';

List<String> _ids(Iterable<TranscriptItem> items) => [
  for (final item in items) item.id,
];

void main() {
  late SessionRig rig;

  Future<SessionController> open(
    AgentCache cache,
    List<TranscriptItem> newestFirst, {
    String? nextCursor,
  }) {
    rig.bridge
      ..on<SessionAttachRequest>((request) => snapshotAnswer(request))
      ..on<TranscriptReadRequest>(
        (request) => pageAnswer(request, newestFirst, nextCursor: nextCursor),
      )
      ..on<SessionGetRequest>(
        (request) => SessionGetResponse(
          requestId: request.requestId,
          result: const SessionFound(summary: summary),
        ),
      );
    return rig.controller(cache: cache);
  }

  late MemoryTextStore store;
  late AgentCache cache;

  setUp(() async {
    rig = await SessionRig.start();
    store = MemoryTextStore();
    cache = AgentCache(store);
  });

  tearDown(() => rig.dispose());

  test('a transcript read is saved for the next time', () async {
    final controller = await open(cache, [userItem('b'), userItem('a')]);
    expect(_ids(controller.state.history.items), ['a', 'b']);
    final saved = await cache.history(sessionRef);
    expect(_ids(saved!.value.items), ['a', 'b']);
  });

  test(
    'a saved transcript shows at once, marked, while the link is down',
    () async {
      await cache.saveHistory(sessionRef, [
        userItem('a'),
        userItem('b'),
      ], IdStability.stable);
      rig.link.down();
      await pumpEventQueue();
      final controller = await rig.controller(cache: cache);
      final history = controller.state.history;
      expect(_ids(history.items), ['a', 'b']);
      expect(history.savedAt, isNotNull);
      expect(history.complete, isTrue, reason: 'no older page is on offer');
      expect(controller.state.controllable, isFalse);
    },
  );

  test('the bridge\'s newest page replaces the saved copy', () async {
    await cache.saveHistory(sessionRef, [
      userItem('a'),
      userItem('b'),
    ], IdStability.stable);
    final controller = await open(cache, [
      userItem('c'),
      userItem('b'),
    ], nextCursor: 'n');
    final history = controller.state.history;
    expect(_ids(history.items), ['b', 'c']);
    expect(history.savedAt, isNull);
    expect(history.olderCursor, 'n');
    expect(history.complete, isFalse);
  });

  test('a saved copy never replaces what the bridge already gave', () async {
    final controller = await open(cache, [userItem('z')]);
    await cache.saveHistory(sessionRef, [userItem('a')], IdStability.stable);
    final late = await rig.controller(cache: cache);
    await pumpEventQueue();
    expect(_ids(controller.state.history.items), ['z']);
    expect(late.state.history.savedAt, isNull);
  });
}
