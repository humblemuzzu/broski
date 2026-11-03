import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/notify/run_completion_watcher.dart';
import 'package:broski/agent/notify/session_viewing.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/manual_clock.dart';
import '../support/recording_run_done_notifier.dart';
import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

SessionRef _ref(String id) => SessionRef(backend: BackendId.pi, sessionId: id);

SessionSummary _row(
  String id,
  SessionStatus status, {
  String? title,
  String? cwd = '/work/shop',
  SessionParent? parent,
}) => SessionSummary(
  session: _ref(id),
  parent: parent,
  title: title == null
      ? null
      : SessionTitle(text: title, source: TitleSource.user),
  cwd: cwd,
  updatedAt: 1,
  archived: false,
  status: status,
  origin: SessionOrigin.broski,
);

void main() {
  group('the watcher', () {
    late WidgetRig rig;
    late ManualClock clock;
    late RecordingRunDoneNotifier notifier;
    late SessionViewing viewing;
    var foreground = true;

    void row(String id, SessionStatus status, {String? title}) =>
        rig.bridge.catalog(
          BackendId.pi,
          SessionUpdatedEvent(summary: _row(id, status, title: title)),
        );

    setUp(() {
      foreground = true;
      rig = WidgetRig();
      clock = ManualClock();
      notifier = RecordingRunDoneNotifier();
      viewing = SessionViewing();
      RunCompletionWatcher(
        client: rig.client,
        viewing: viewing,
        notifier: notifier,
        clock: clock,
        appInForeground: () => foreground,
      );
    });

    tearDown(() => rig.dispose());

    test('a run that finishes in a session nobody watches is told', () async {
      row('a', SessionStatus.running, title: 'Fix it');
      await clock.advance(const Duration(seconds: 42));
      row('a', SessionStatus.idle, title: 'Fix it');
      expect(notifier.done, hasLength(1));
      final done = notifier.done.single;
      expect(done.session, _ref('a'));
      expect(done.title, 'Fix it');
      expect(done.project, 'shop');
      expect(done.duration, const Duration(seconds: 42));
    });

    test('a subagent\'s run is its parent\'s, which alone is told; a fork '
        'is told like any session', () async {
      void child(String id, SessionStatus status, ParentKind kind) =>
          rig.bridge.catalog(
            BackendId.pi,
            SessionUpdatedEvent(
              summary: _row(
                id,
                status,
                parent: SessionParent(kind: kind, session: _ref('parent')),
              ),
            ),
          );
      child('parent:call-1', SessionStatus.running, ParentKind.subagent);
      child('fork', SessionStatus.running, ParentKind.fork);
      await pumpEventQueue();
      child('parent:call-1', SessionStatus.idle, ParentKind.subagent);
      child('fork', SessionStatus.idle, ParentKind.fork);
      await pumpEventQueue();
      expect(notifier.done.map((done) => done.session.sessionId), ['fork']);
    });

    test('an ask waiting inside a run does not end it', () {
      row('a', SessionStatus.running);
      row('a', SessionStatus.waitingForUser);
      expect(notifier.done, isEmpty);
      row('a', SessionStatus.idle);
      expect(notifier.done, hasLength(1));
    });

    test('a session seen idle, or never seen busy, says nothing', () {
      row('a', SessionStatus.idle);
      row('a', SessionStatus.idle);
      expect(notifier.done, isEmpty);
    });

    test('a run that ends in a suspended or unknown state is not done', () {
      row('a', SessionStatus.running);
      row('a', SessionStatus.unknown);
      row('a', SessionStatus.idle);
      expect(notifier.done, isEmpty);
    });

    test('a session on screen with the app in front says nothing', () {
      viewing.opened(_ref('a'));
      row('a', SessionStatus.running);
      row('a', SessionStatus.idle);
      row('b', SessionStatus.running);
      row('b', SessionStatus.idle);
      expect([for (final done in notifier.done) done.session], [_ref('b')]);
    });

    test('a session on screen with the app away is told', () {
      viewing.opened(_ref('a'));
      foreground = false;
      row('a', SessionStatus.running);
      row('a', SessionStatus.idle);
      expect(notifier.done, hasLength(1));
    });

    test('a removed session forgets its run', () {
      row('a', SessionStatus.running);
      rig.bridge.catalog(BackendId.pi, SessionRemovedEvent(session: _ref('a')));
      row('a', SessionStatus.idle);
      expect(notifier.done, isEmpty);
    });
  });

  testWidgets('the chat on screen is the one watched, and no other', (
    tester,
  ) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    final notifier = RecordingRunDoneNotifier();
    final overrides = [runDoneNotifierProvider.overrideWithValue(notifier)];

    void finishRun(String id) {
      rig.bridge
        ..catalog(
          BackendId.pi,
          SessionUpdatedEvent(summary: _row(id, SessionStatus.running)),
        )
        ..catalog(
          BackendId.pi,
          SessionUpdatedEvent(summary: _row(id, SessionStatus.idle)),
        );
    }

    Widget host(Widget child) => Consumer(
      builder: (context, ref, _) {
        ref.read(runCompletionWatcherProvider);
        return child;
      },
    );

    await rig.pump(
      tester,
      host(const AgentChatScreen(session: sessionRef)),
      overrides: overrides,
    );
    finishRun('s1');
    finishRun('s2');
    expect([for (final done in notifier.done) done.session.sessionId], ['s2']);

    await rig.pump(tester, host(const SizedBox()), overrides: overrides);
    finishRun('s1');
    expect(
      [for (final done in notifier.done) done.session.sessionId],
      ['s2', 's1'],
    );
  });
}
