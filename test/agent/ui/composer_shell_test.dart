import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/composer/shell_command.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

final _withShell = Capabilities.fromJson({
  ...everything.toJson(),
  'backendOps': ['run_shell'],
});

Future<WidgetRig> _chat(
  WidgetTester tester, {
  Capabilities? capabilities,
  SessionSnapshot? snapshot,
}) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final rig = WidgetRig(
    capabilities: capabilities ?? _withShell,
    snapshot: snapshot,
  );
  addTearDown(rig.dispose);
  await rig.pump(tester, const AgentChatScreen(session: sessionRef));
  return rig;
}

Finder _key(String key) => find.byKey(ValueKey(key));

Future<void> _type(WidgetTester tester, String text) async {
  await tester.enterText(_key('composer-text'), text);
  await tester.pump();
}

RunShellOp _shell(WidgetRig rig) =>
    ((rig.sent<BackendCallRequest>()).call as PiCall).op as RunShellOp;

void main() {
  test('a line is a command the way a terminal reads it', () {
    expect(shellCommandOf('!ls -la')?.command, 'ls -la');
    expect(shellCommandOf('!ls -la')?.excludeFromContext, isFalse);
    expect(shellCommandOf('  !!  git status ')?.command, 'git status');
    expect(shellCommandOf('!!git status')?.excludeFromContext, isTrue);
    expect(shellCommandOf('!'), isNull);
    expect(shellCommandOf('!!   '), isNull);
    expect(shellCommandOf('what does !ls do'), isNull);
  });

  testWidgets('!command runs in the shell with its output in context, and the '
      'composer clears once it started', (tester) async {
    final rig = await _chat(tester);
    rig.bridge.on<BackendCallRequest>(
      (request) => BackendCallResponse(
        requestId: request.requestId,
        result: const BackendCallAccepted(result: ShellStarted()),
      ),
    );
    await _type(tester, '!ls -la');
    expect(_key('composer-shell'), findsOneWidget);
    expect(find.textContaining('goes to the model'), findsOneWidget);
    await tester.tap(_key('composer-send'));
    await WidgetRig.settle(tester);
    final op = _shell(rig);
    expect(op.command, 'ls -la');
    expect(op.excludeFromContext, isFalse);
    expect(op.sessionId, 's1');
    expect(rig.link.sent.whereType<PromptRequest>(), isEmpty);
    expect(
      tester.widget<TextField>(_key('composer-text')).controller?.text,
      '',
    );
  });

  testWidgets('!!command keeps the output out of the model, and says so', (
    tester,
  ) async {
    final rig = await _chat(tester);
    rig.bridge.on<BackendCallRequest>(
      (request) => BackendCallResponse(
        requestId: request.requestId,
        result: const BackendCallAccepted(result: ShellStarted()),
      ),
    );
    await _type(tester, '!!cat secrets.txt');
    expect(find.textContaining('stays out of the model'), findsOneWidget);
    await tester.tap(_key('composer-send'));
    await WidgetRig.settle(tester);
    expect(_shell(rig).excludeFromContext, isTrue);
    expect(_shell(rig).command, 'cat secrets.txt');
  });

  testWidgets('a bare ! is a message, and so is !text where the backend has '
      'no shell', (tester) async {
    final rig = await _chat(tester);
    rig.bridge.on<PromptRequest>(
      (request) => PromptResponse(
        requestId: request.requestId,
        result: const PromptAccepted(disposition: PromptDisposition.started),
      ),
    );
    await _type(tester, '!');
    expect(_key('composer-shell'), findsNothing);
    await tester.tap(_key('composer-send'));
    await WidgetRig.settle(tester);
    expect(rig.sent<PromptRequest>().input.text, '!');

    final plain = await _chat(tester, capabilities: everything);
    plain.bridge.on<PromptRequest>(
      (request) => PromptResponse(
        requestId: request.requestId,
        result: const PromptAccepted(disposition: PromptDisposition.started),
      ),
    );
    await _type(tester, '!ls');
    expect(_key('composer-shell'), findsNothing);
    await tester.tap(_key('composer-send'));
    await WidgetRig.settle(tester);
    expect(plain.sent<PromptRequest>().input.text, '!ls');
    expect(plain.link.sent.whereType<BackendCallRequest>(), isEmpty);
  });

  testWidgets('a refused command keeps what was typed and says why', (
    tester,
  ) async {
    final rig = await _chat(tester);
    rig.bridge.on<BackendCallRequest>(
      (request) => BackendCallResponse(
        requestId: request.requestId,
        result: const Rejected(
          rejection: Rejection(
            code: RejectionCode.busy,
            message: 'a bash command is already running',
          ),
        ),
      ),
    );
    await _type(tester, '!sleep 9');
    await tester.tap(_key('composer-send'));
    await WidgetRig.settle(tester);
    expect(find.text('a bash command is already running'), findsOneWidget);
    expect(
      tester.widget<TextField>(_key('composer-text')).controller?.text,
      '!sleep 9',
    );
  });

  testWidgets('while a run is on the command waits: the button is off', (
    tester,
  ) async {
    final rig = await _chat(
      tester,
      snapshot: replacing(
        emptySnapshot(),
        run: const ActiveRun(
          runId: 'r1',
          trigger: RunTrigger.prompt,
          startedAt: 1,
          items: [],
          droppedItems: 0,
        ),
      ),
    );
    await _type(tester, '!ls');
    expect(
      find.text('Wait for the run to end to run this command.'),
      findsOneWidget,
    );
    expect(tester.widget<IconButton>(_key('composer-send')).onPressed, isNull);
    expect(rig.link.sent.whereType<BackendCallRequest>(), isEmpty);
  });
}
