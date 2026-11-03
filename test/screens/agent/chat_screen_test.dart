import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/session_fixtures.dart';
import '../../agent/support/widget_rig.dart';

const _run = ActiveRun(
  runId: 'r1',
  trigger: RunTrigger.prompt,
  startedAt: 1,
  items: [
    UserMessageItem(id: 'u1', text: 'Fix it', attachments: []),
    ToolCallItem(id: 't1', toolCallId: 't1', name: 'bash'),
  ],
  droppedItems: 0,
);

final _running = replacing(
  emptySnapshot(),
  run: _run,
  blocks: const [
    OpenBlock(
      blockId: 'b1',
      messageId: 'm1',
      kind: BlockKind.text,
      text: 'Look',
    ),
  ],
  tools: const [
    RunningTool(toolCallId: 't1', name: 'bash', output: 'ok', fileChanges: []),
  ],
  queue: const [
    QueueItem(id: 'q1', delivery: QueuedDelivery.queue, preview: 'then lint'),
  ],
);

Future<WidgetRig> _chat(
  WidgetTester tester, {
  Capabilities capabilities = everything,
  SessionSnapshot? snapshot,
  SessionCapabilities session = controllable,
}) async {
  final rig = WidgetRig(
    capabilities: capabilities,
    snapshot: snapshot,
    session: session,
  );
  addTearDown(rig.dispose);
  await rig.pump(tester, const AgentChatScreen(session: sessionRef));
  return rig;
}

Finder _key(String key) => find.byKey(ValueKey(key));

void main() {
  testWidgets('a running session shows its work, its queue and Stop', (
    tester,
  ) async {
    final rig = await _chat(tester, snapshot: _running);
    expect(find.text('Fix it'), findsOneWidget);
    expect(find.text('Look'), findsOneWidget);
    expect(
      find.textContaining(RegExp('bash', caseSensitive: false)),
      findsWidgets,
    );
    expect(_key('queue-item:q1'), findsOneWidget);
    expect(_key('agent-stop-bar'), findsOneWidget);
    rig.bridge.on<AbortRequest>(
      (request) => AbortResponse(
        requestId: request.requestId,
        result: const ActionAccepted(),
      ),
    );
    await tester.tap(_key('agent-stop'));
    await WidgetRig.settle(tester);
    expect(rig.sent<AbortRequest>().session, sessionRef);
  });

  testWidgets(
    'a session replaced while the phone was away is followed, and the '
    'person is told',
    (tester) async {
      final rig = await _chat(tester);
      const next = SessionRef(backend: BackendId.pi, sessionId: 's2');
      rig.bridge.on<SessionAttachRequest>(
        (request) => request.session == next
            ? snapshotAnswer(request)
            : SessionAttachResponse(
                requestId: request.requestId,
                capabilities: controllable,
                sync: const ReplacedSync(epoch: 'e1', session: next),
              ),
      );
      rig.link.down();
      rig.link.up();
      await WidgetRig.settle(tester);
      expect(
        rig.link.sent.whereType<SessionAttachRequest>().map(
          (request) => request.session,
        ),
        [sessionRef, sessionRef, next],
      );
      expect(
        find.text('This conversation continued in a new session'),
        findsOneWidget,
      );
    },
  );

  testWidgets('while a run is on, the composer steers or queues', (
    tester,
  ) async {
    await _chat(tester, snapshot: _running);
    expect(_key('composer-mode'), findsOneWidget);
    expect(find.text('Steer now'), findsOneWidget);
    expect(find.text('Queue'), findsOneWidget);
  });

  testWidgets('a backend that takes no input mid-run says so', (tester) async {
    await _chat(tester, capabilities: nothing, snapshot: _running);
    expect(
      find.text('This backend takes no input while a run is on.'),
      findsOneWidget,
    );
    expect(_key('attach-image'), findsNothing);
    expect(_key('pick-command'), findsNothing);
    await tester.tap(_key('chat-panels'));
    await WidgetRig.settle(tester);
    expect(_key('chat-copy-conversation'), findsOneWidget);
    expect(_key('chat-open-as-fork'), findsNothing);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget.key is ValueKey<String> &&
            (widget.key! as ValueKey<String>).value.startsWith('panel:'),
      ),
      findsNothing,
      reason: 'no backend operation is offered',
    );
  });

  testWidgets('an idle session sends a prompt and shows it at once', (
    tester,
  ) async {
    final rig = await _chat(tester);
    expect(_key('composer-mode'), findsNothing);
    await tester.tap(_key('composer-attach'));
    await WidgetRig.settle(tester);
    expect(_key('attach-image'), findsOneWidget);
    expect(_key('mention-agent'), findsOneWidget);
    Navigator.of(tester.element(_key('attach-image'))).pop();
    await WidgetRig.settle(tester);
    rig.bridge.on<PromptRequest>((_) => null);
    await tester.enterText(_key('composer-text'), 'Hello');
    await tester.pump();
    await tester.tap(_key('composer-send'));
    await tester.pump();
    expect(find.text('Hello'), findsOneWidget);
    expect(find.text('Sending…'), findsOneWidget);
    await tester.pump();
    final sent = rig.bridge.waiting<PromptRequest>();
    expect(sent.input.mode, PromptMode.start);
    expect(sent.input.text, 'Hello');
  });

  testWidgets('a Mac that speaks another protocol says so, not that it waits', (
    tester,
  ) async {
    final rig = await _chat(tester);
    rig.bridge.helloMajor = contractProtocolMajor + 1;
    rig.link.down();
    rig.link.up();
    await WidgetRig.settle(tester);
    expect(find.textContaining('the Mac speaks protocol'), findsOneWidget);
    expect(find.text('Waiting for the connection…'), findsNothing);
  });

  testWidgets('a prompt not confirmed offers to send it again, edit it or '
      'drop it', (tester) async {
    final rig = await _chat(tester);
    rig.bridge.on<PromptRequest>(
      (request) => errorAnswer(request, ProtocolErrorCode.internal),
    );
    await tester.enterText(_key('composer-text'), 'Hello');
    await tester.pump();
    await tester.tap(_key('composer-send'));
    await WidgetRig.settle(tester);
    expect(find.textContaining('Not confirmed: refused'), findsOneWidget);
    final id = rig.sent<PromptRequest>().input.clientRequestId;
    rig.bridge.on<PromptRequest>((_) => null);
    await tester.tap(_key('retry-prompt:$id'));
    await WidgetRig.settle(tester);
    final again = rig.link.sent.whereType<PromptRequest>().toList();
    expect(again, hasLength(2));
    expect(again.last.input.clientRequestId, id);
    expect(find.text('Sending…'), findsOneWidget);
  });

  testWidgets('a finished item offers its actions to a screen reader too', (
    tester,
  ) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    rig.bridge.on<TranscriptReadRequest>(
      (request) => pageAnswer(request, [userItem('u0')]),
    );
    await rig.pump(tester, const AgentChatScreen(session: sessionRef));
    final described = find.byWidgetPredicate(
      (widget) =>
          widget is Semantics &&
          (widget.properties.customSemanticsActions?.keys.any(
                (action) => action.label == 'Actions from here',
              ) ??
              false),
    );
    expect(described, findsOneWidget);
    final semantics = tester.widget<Semantics>(described);
    semantics.properties.customSemanticsActions?.values.single();
    await tester.pumpAndSettle();
    expect(find.text('From here'), findsOneWidget);
  });

  testWidgets('a session that can only be watched offers no control', (
    tester,
  ) async {
    await _chat(
      tester,
      snapshot: _running,
      session: const SessionCapabilities(
        controllable: false,
        compact: false,
        cancelQueued: false,
      ),
    );
    expect(_key('composer'), findsNothing);
    expect(_key('agent-stop-bar'), findsNothing);
    expect(
      find.text('This session is open elsewhere and can only be watched here.'),
      findsOneWidget,
    );
  });

  group('input the backend handed back after Stop', () {
    String composerText(WidgetTester tester) =>
        tester.widget<TextField>(_key('composer-text')).controller!.text;

    testWidgets('goes into an empty composer, in queue order', (tester) async {
      final rig = await _chat(tester);
      rig.bridge.event(
        sessionRef,
        1,
        const InputReturnedEvent(texts: ['Also lint', 'Then commit']),
      );
      await WidgetRig.settle(tester);
      expect(composerText(tester), 'Also lint\n\nThen commit');
    });

    testWidgets('goes before what the person had typed', (tester) async {
      final rig = await _chat(tester);
      await tester.enterText(_key('composer-text'), 'and push');
      await tester.pump();
      rig.bridge.event(
        sessionRef,
        1,
        const InputReturnedEvent(texts: ['Also lint']),
      );
      await WidgetRig.settle(tester);
      expect(composerText(tester), 'Also lint\n\nand push');
    });

    testWidgets('is taken once: a later hand-back adds to what is there', (
      tester,
    ) async {
      final rig = await _chat(tester);
      rig.bridge.event(sessionRef, 1, const InputReturnedEvent(texts: ['one']));
      await WidgetRig.settle(tester);
      rig.bridge.event(sessionRef, 2, const InputReturnedEvent(texts: ['two']));
      await WidgetRig.settle(tester);
      expect(composerText(tester), 'two\n\none');
    });
  });
}
