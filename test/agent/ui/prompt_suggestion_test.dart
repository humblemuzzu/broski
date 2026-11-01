import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

Finder _chip() => find.byKey(const ValueKey('prompt-suggestion'));

String _composerText(WidgetTester tester) => tester
    .widget<TextField>(find.byKey(const ValueKey('composer-text')))
    .controller!
    .text;

Future<WidgetRig> _chat(WidgetTester tester) async {
  final rig = WidgetRig();
  addTearDown(rig.dispose);
  await rig.pump(tester, const AgentChatScreen(session: sessionRef));
  return rig;
}

Future<void> _suggest(
  WidgetTester tester,
  WidgetRig rig,
  int seq,
  String text,
) {
  rig.bridge.event(
    sessionRef,
    seq,
    ExtensionEvent(extension: PromptSuggestion(text: text)),
  );
  return WidgetRig.settle(tester);
}

void main() {
  testWidgets('the suggestion is a tappable hint above the composer', (
    tester,
  ) async {
    final rig = await _chat(tester);
    expect(_chip(), findsNothing);
    await _suggest(tester, rig, 1, 'Run the tests');
    expect(_chip(), findsOneWidget);
    expect(find.text('Run the tests'), findsOneWidget);
  });

  testWidgets('a tap fills the composer and sends nothing', (tester) async {
    final rig = await _chat(tester);
    await _suggest(tester, rig, 1, 'Run the tests');
    await tester.tap(_chip());
    await WidgetRig.settle(tester);
    expect(_composerText(tester), 'Run the tests');
    expect(rig.link.sent.whereType<PromptRequest>(), isEmpty);
    expect(_chip(), findsNothing, reason: 'the text is in the composer now');
  });

  testWidgets('it waits while the person has typed something', (tester) async {
    final rig = await _chat(tester);
    await _suggest(tester, rig, 1, 'Run the tests');
    await tester.enterText(
      find.byKey(const ValueKey('composer-text')),
      'my own',
    );
    await tester.pump();
    expect(_chip(), findsNothing);
    await tester.enterText(find.byKey(const ValueKey('composer-text')), '');
    await tester.pump();
    expect(_chip(), findsOneWidget);
  });

  testWidgets('a newer suggestion replaces the one before', (tester) async {
    final rig = await _chat(tester);
    await _suggest(tester, rig, 1, 'Run the tests');
    await _suggest(tester, rig, 2, 'Commit it');
    expect(find.text('Run the tests'), findsNothing);
    expect(find.text('Commit it'), findsOneWidget);
  });

  testWidgets('it goes when a run starts and does not come back with the '
      'run\'s end', (tester) async {
    final rig = await _chat(tester);
    await _suggest(tester, rig, 1, 'Run the tests');
    rig.bridge.event(
      sessionRef,
      2,
      const RunStartedEvent(runId: 'r1', trigger: RunTrigger.prompt),
    );
    await WidgetRig.settle(tester);
    expect(_chip(), findsNothing);

    rig.bridge.event(
      sessionRef,
      3,
      const RunFinishedEvent(runId: 'r1', outcome: RunCompleted()),
    );
    await WidgetRig.settle(tester);
    expect(_chip(), findsNothing, reason: 'that one was used up by the run');

    await _suggest(tester, rig, 4, 'Commit it');
    expect(find.text('Commit it'), findsOneWidget);
  });

  testWidgets('one that arrives while the run is still ending is offered '
      'when it has ended', (tester) async {
    final rig = await _chat(tester);
    rig.bridge.event(
      sessionRef,
      1,
      const RunStartedEvent(runId: 'r1', trigger: RunTrigger.prompt),
    );
    await WidgetRig.settle(tester);
    await _suggest(tester, rig, 2, 'Commit it');
    expect(_chip(), findsNothing, reason: 'no hint while a run is on');
    rig.bridge.event(
      sessionRef,
      3,
      const RunFinishedEvent(runId: 'r1', outcome: RunCompleted()),
    );
    await WidgetRig.settle(tester);
    expect(find.text('Commit it'), findsOneWidget);
  });
}
