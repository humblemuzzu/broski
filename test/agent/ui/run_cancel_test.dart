import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

const _cancelling = SessionCapabilities(
  controllable: true,
  compact: true,
  cancelQueued: true,
  cancelCompaction: true,
  cancelRetry: true,
);

final _retrying = emptySnapshot().copyWithRetry();

extension on SessionSnapshot {
  SessionSnapshot copyWithRetry() => SessionSnapshot(
    blocks: blocks,
    tools: tools,
    interactions: interactions,
    queue: queue,
    modes: modes,
    retry: const RetryState(attempt: 2, maxAttempts: 3, message: 'overloaded'),
  );

  SessionSnapshot copyWithCompaction() => SessionSnapshot(
    blocks: blocks,
    tools: tools,
    interactions: interactions,
    queue: queue,
    modes: modes,
    compaction: const CompactionState(
      trigger: CompactionTrigger.auto,
      startedAt: 1,
    ),
  );
}

Future<WidgetRig> _chat(
  WidgetTester tester, {
  required SessionSnapshot snapshot,
  required SessionCapabilities session,
}) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final rig = WidgetRig(snapshot: snapshot, session: session);
  addTearDown(rig.dispose);
  await rig.pump(tester, const AgentChatScreen(session: sessionRef));
  return rig;
}

Finder _key(String key) => find.byKey(ValueKey(key));

void main() {
  group('a retry that is scheduled', () {
    testWidgets('can be cancelled on its own, and the cancel names the '
        'session', (tester) async {
      final rig = await _chat(
        tester,
        snapshot: _retrying,
        session: _cancelling,
      );
      rig.bridge.on<RetryCancelRequest>(
        (request) => RetryCancelResponse(
          requestId: request.requestId,
          result: const ActionAccepted(),
        ),
      );
      expect(find.textContaining('Retrying (attempt 2 of 3)'), findsOneWidget);

      await tester.tap(_key('cancel-retry'));
      await tester.pump();

      expect(rig.sent<RetryCancelRequest>().session, sessionRef);
      expect(rig.link.sent.whereType<AbortRequest>(), isEmpty);
      expect(rig.link.sent.whereType<CompactionCancelRequest>(), isEmpty);
    });

    testWidgets('says why when the bridge refuses', (tester) async {
      final rig = await _chat(
        tester,
        snapshot: _retrying,
        session: _cancelling,
      );
      rig.bridge.on<RetryCancelRequest>(
        (request) => RetryCancelResponse(
          requestId: request.requestId,
          result: const Rejected(
            rejection: Rejection(
              code: RejectionCode.stale,
              message: 'the next attempt has already started',
            ),
          ),
        ),
      );
      await tester.tap(_key('cancel-retry'));
      await WidgetRig.settle(tester);
      expect(
        find.textContaining('the next attempt has already started'),
        findsOneWidget,
      );
    });

    testWidgets('has no cancel where the session cannot cancel it, or '
        'cannot be driven', (tester) async {
      await _chat(tester, snapshot: _retrying, session: controllable);
      expect(find.textContaining('Retrying'), findsOneWidget);
      expect(_key('cancel-retry'), findsNothing);
    });

    testWidgets('has no cancel on a session that can only be watched', (
      tester,
    ) async {
      await _chat(
        tester,
        snapshot: _retrying,
        session: const SessionCapabilities(
          controllable: false,
          compact: false,
          cancelQueued: false,
          cancelCompaction: true,
          cancelRetry: true,
        ),
      );
      expect(find.textContaining('Retrying'), findsOneWidget);
      expect(_key('cancel-retry'), findsNothing);
    });
  });

  group('a compaction under way', () {
    testWidgets('can be cancelled on its own', (tester) async {
      final rig = await _chat(
        tester,
        snapshot: emptySnapshot().copyWithCompaction(),
        session: _cancelling,
      );
      rig.bridge.on<CompactionCancelRequest>(
        (request) => CompactionCancelResponse(
          requestId: request.requestId,
          result: const ActionAccepted(),
        ),
      );
      expect(find.textContaining('Compacting the context'), findsOneWidget);

      await tester.tap(_key('cancel-compaction'));
      await tester.pump();

      expect(rig.sent<CompactionCancelRequest>().session, sessionRef);
      expect(rig.link.sent.whereType<AbortRequest>(), isEmpty);
      expect(rig.link.sent.whereType<RetryCancelRequest>(), isEmpty);
    });

    testWidgets('has no cancel where the session cannot cancel it', (
      tester,
    ) async {
      await _chat(
        tester,
        snapshot: emptySnapshot().copyWithCompaction(),
        session: controllable,
      );
      expect(find.textContaining('Compacting the context'), findsOneWidget);
      expect(_key('cancel-compaction'), findsNothing);
    });
  });

  testWidgets('with nothing under way there is nothing to cancel, whatever '
      'the session allows', (tester) async {
    await _chat(tester, snapshot: emptySnapshot(), session: _cancelling);
    expect(_key('cancel-retry'), findsNothing);
    expect(_key('cancel-compaction'), findsNothing);
  });

  testWidgets('a session that is retrying and compacting offers both, '
      'each for its own line', (tester) async {
    const both = SessionSnapshot(
      blocks: [],
      tools: [],
      interactions: [],
      queue: [],
      modes: [],
      retry: RetryState(attempt: 1, message: 'overloaded'),
      compaction: CompactionState(
        trigger: CompactionTrigger.manual,
        startedAt: 1,
      ),
    );
    await _chat(tester, snapshot: both, session: _cancelling);
    expect(_key('cancel-retry'), findsOneWidget);
    expect(_key('cancel-compaction'), findsOneWidget);
  });
}
