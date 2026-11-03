import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/activity_card.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/session_fixtures.dart';
import '../../agent/support/widget_rig.dart';

const _hook = Activity(
  id: 'hook:1',
  label: 'PreToolUse:Read',
  detail: 'PreToolUse',
  status: ActivityStatus.running,
);

final _running = replacing(
  emptySnapshot(),
  run: const ActiveRun(
    runId: 'r1',
    trigger: RunTrigger.prompt,
    startedAt: 1,
    items: [UserMessageItem(id: 'u1', text: 'Read it', attachments: [])],
    droppedItems: 0,
  ),
);

Finder _key(String key) => find.byKey(ValueKey(key));

void main() {
  testWidgets('a live activity shows running, then its outcome and duration, '
      'in one row', (tester) async {
    final rig = WidgetRig(snapshot: _running);
    addTearDown(rig.dispose);
    await rig.pump(tester, const AgentChatScreen(session: sessionRef));

    rig.bridge.event(sessionRef, 1, const ActivityEvent(activity: _hook));
    await WidgetRig.settle(tester);
    expect(find.text('PreToolUse:Read · PreToolUse · running'), findsOneWidget);
    expect(
      find.descendant(
        of: _key('activity-row:hook:1'),
        matching: find.byType(CircularProgressIndicator),
      ),
      findsOneWidget,
    );

    rig.bridge.event(
      sessionRef,
      2,
      const ActivityEvent(
        activity: Activity(
          id: 'hook:1',
          label: 'PreToolUse:Read',
          detail: 'PreToolUse',
          status: ActivityStatus.failed,
          output: 'no access',
          durationMs: 1250,
        ),
      ),
    );
    await WidgetRig.settle(tester);
    expect(_key('activity-row:hook:1'), findsOneWidget);
    expect(
      find.text('PreToolUse:Read · PreToolUse · failed · 1.3 s'),
      findsOneWidget,
    );
    expect(find.text('no access'), findsNothing, reason: 'folded at first');
    await tester.tap(_key('activity-row:hook:1'));
    await WidgetRig.settle(tester);
    expect(find.text('no access'), findsOneWidget);
  });

  testWidgets('a hook in history is a compact row too', (tester) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    rig.bridge.on<TranscriptReadRequest>(
      (request) => pageAnswer(request, [
        const ActivityItem(
          id: 'entry-1',
          label: 'Stop',
          status: ActivityStatus.succeeded,
          durationMs: 7,
        ),
      ]),
    );
    await rig.pump(tester, const AgentChatScreen(session: sessionRef));
    expect(find.text('Stop · done · 7 ms'), findsOneWidget);
    await tester.tap(_key('activity-row:entry-1'));
    await WidgetRig.settle(tester);
    expect(_key('activity-output:entry-1'), findsNothing);
  });

  test('the summary names what ran, when, how it ended and how long', () {
    const item = ActivityItem(
      id: 'a',
      label: 'Notification',
      status: ActivityStatus.cancelled,
    );
    expect(activitySummary(item), 'Notification · cancelled');
    expect(durationText(999), '999 ms');
    expect(durationText(61000), '61.0 s');
  });
}
