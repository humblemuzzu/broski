import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/session_fixtures.dart';
import '../../agent/support/widget_rig.dart';

Finder _key(String key) => find.byKey(ValueKey(key));

Future<WidgetRig> _chat(
  WidgetTester tester, {
  Capabilities capabilities = everything,
  SessionSnapshot? snapshot,
  SessionCapabilities session = controllable,
  List<TranscriptItem> newestFirst = const [],
}) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final rig = WidgetRig(
    capabilities: capabilities,
    snapshot: snapshot,
    session: session,
  );
  addTearDown(rig.dispose);
  rig.bridge.on<TranscriptReadRequest>(
    (request) => pageAnswer(request, newestFirst),
  );
  await rig.pump(tester, const AgentChatScreen(session: sessionRef));
  return rig;
}

final _running = replacing(
  emptySnapshot(),
  run: const ActiveRun(
    runId: 'r1',
    trigger: RunTrigger.prompt,
    startedAt: 1,
    items: [],
    droppedItems: 0,
  ),
);

const _review = CommandSummary(
  id: 'cmd-review',
  name: 'review',
  kind: CommandKind.prompt,
  argumentHint: '<what to review>',
);

void main() {
  testWidgets('a command typed after / is picked from the popup, says what it '
      'takes, and goes with the prompt', (tester) async {
    final rig = await _chat(tester);
    rig.bridge.on<CommandsListRequest>(
      (request) => CommandsListResponse(
        requestId: request.requestId,
        result: const CommandsListed(commands: [_review]),
      ),
    );
    await tester.enterText(_key('composer-text'), '/rev');
    await WidgetRig.settle(tester);
    expect(_key('slash-commands'), findsOneWidget);
    await tester.tap(find.text('/review').last);
    await WidgetRig.settle(tester);
    expect(_key('composer-command'), findsOneWidget);
    expect(find.text('<what to review>'), findsOneWidget);
    rig.bridge.on<PromptRequest>((_) => null);
    await tester.enterText(_key('composer-text'), 'the parser');
    await tester.pump();
    await tester.tap(_key('composer-send'));
    await tester.pump();
    final sent = rig.bridge.waiting<PromptRequest>();
    expect(sent.input.command, 'cmd-review');
    expect(sent.input.text, 'the parser');
  });

  testWidgets('while a run is on, a long press sends the other way in', (
    tester,
  ) async {
    final rig = await _chat(tester, snapshot: _running);
    rig.bridge.on<PromptRequest>((_) => null);
    await tester.enterText(_key('composer-text'), 'then lint');
    await tester.pump();
    await tester.longPress(_key('composer-send'));
    await tester.pump();
    expect(rig.bridge.waiting<PromptRequest>().input.mode, PromptMode.queue);
  });

  testWidgets('a mentioned file is one chip with one @', (tester) async {
    await _chat(tester);
    await tester.tap(_key('composer-attach'));
    await tester.pumpAndSettle();
    await tester.tap(_key('mention-file'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      ),
      'lib/a.dart',
    );
    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();
    expect(find.text('@lib/a.dart'), findsOneWidget);
    expect(find.textContaining('@@'), findsNothing);
  });

  testWidgets('with nothing to offer there is no way to the More sheet', (
    tester,
  ) async {
    await _chat(
      tester,
      capabilities: nothing,
      session: const SessionCapabilities(
        controllable: true,
        compact: false,
        cancelQueued: false,
      ),
    );
    expect(_key('composer'), findsOneWidget);
    expect(_key('chat-panels'), findsNothing);
    expect(_key('chat-actions'), findsNothing);
  });

  testWidgets('a turn forks just before its first block or through its last', (
    tester,
  ) async {
    final rig = await _chat(
      tester,
      newestFirst: const [
        BlockItem(
          id: 'b2',
          messageId: 'm1',
          block: BlockKind.text,
          text: 'Second part',
        ),
        BlockItem(
          id: 'b1',
          messageId: 'm1',
          block: BlockKind.text,
          text: 'First part',
        ),
        UserMessageItem(id: 'u1', text: 'Go', attachments: []),
      ],
    );
    rig.bridge.on<SessionForkRequest>((_) => null);
    Future<ForkPoint?> forkAt(String position) async {
      final actions = find.ancestor(
        of: find.textContaining('Second part'),
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is Semantics &&
              (widget.properties.customSemanticsActions?.keys.any(
                    (action) => action.label == 'Actions from here',
                  ) ??
                  false),
        ),
      );
      tester
          .widget<Semantics>(actions.first)
          .properties
          .customSemanticsActions
          ?.values
          .single();
      await tester.pumpAndSettle();
      await tester.tap(_key('fork:$position'));
      await tester.pump();
      return rig.bridge.waiting<SessionForkRequest>().at;
    }

    expect((await forkAt('before'))?.itemId, 'b1');
    expect((await forkAt('through'))?.itemId, 'b2');
  });
}
