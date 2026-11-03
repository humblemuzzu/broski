import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/session_fixtures.dart';
import '../../agent/support/widget_rig.dart';

const _watchedNote =
    'This session is open elsewhere and can only be watched here.';

const _ask = Interaction(
  id: 'i1',
  runId: 'r1',
  createdAt: 1,
  title: 'Run rm -rf build?',
  blocksRun: true,
  request: ToolPermissionRequest(
    inputEditable: false,
    previews: [CommandPreview(command: 'rm -rf build')],
    options: [
      PermissionOption(
        id: 'allow',
        label: 'Allow',
        effect: PermissionEffect.allow,
        scope: PermissionScope.once,
        stopsRun: false,
        message: MessagePolicy.none,
      ),
    ],
    grants: [],
    deliberate: false,
  ),
);

final _asking = replacing(
  emptySnapshot(),
  run: const ActiveRun(
    runId: 'r1',
    trigger: RunTrigger.external,
    startedAt: 1,
    items: [],
    droppedItems: 0,
  ),
  interactions: const [_ask],
);

SessionCapabilities _watched({bool? answer}) => SessionCapabilities(
  controllable: false,
  compact: false,
  cancelQueued: false,
  answer: answer,
);

Future<WidgetRig> _chat(
  WidgetTester tester,
  SessionCapabilities session,
) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final rig = WidgetRig(snapshot: _asking, session: session);
  addTearDown(rig.dispose);
  await rig.pump(tester, const AgentChatScreen(session: sessionRef));
  return rig;
}

Finder _key(String key) => find.byKey(ValueKey(key));

Finder get _answerButton => _key('interaction-answer:i1');

void main() {
  testWidgets('a watch-only session that takes answers offers Answer and '
      'sends it, while the composer stays hidden', (tester) async {
    final rig = await _chat(tester, _watched(answer: true));
    expect(_key('composer'), findsNothing);
    expect(_key('agent-stop-bar'), findsNothing);
    expect(find.text(_watchedNote), findsOneWidget);
    expect(_answerButton, findsOneWidget);
    expect(
      find.text('Run rm -rf build?'),
      findsNWidgets(2),
      reason: 'a new ask opens its sheet by itself, over the bar',
    );
    await tester.pump(const Duration(seconds: 1));
    expect(
      rig.link.sent.whereType<InteractionAnswerRequest>(),
      isEmpty,
      reason: 'opening the sheet answers nothing; only the person does',
    );

    rig.bridge.on<InteractionAnswerRequest>(
      (request) => InteractionAnswerResponse(
        requestId: request.requestId,
        result: const ActionAccepted(),
      ),
    );
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(_key('permission-option:allow'));
    await WidgetRig.settle(tester);
    final sent = rig.sent<InteractionAnswerRequest>();
    expect(sent.session, sessionRef);
    expect(sent.answer.interactionId, 'i1');
    expect((sent.answer.reply as ToolPermissionReply).optionId, 'allow');
  });

  testWidgets('a watch-only session that takes no answers shows its ask '
      'without Answer', (tester) async {
    await _chat(tester, _watched(answer: false));
    expect(find.text('Run rm -rf build?'), findsOneWidget);
    expect(_answerButton, findsNothing);
    expect(find.text(_watchedNote), findsOneWidget);
  });

  testWidgets('a bridge that does not say goes by controllable', (
    tester,
  ) async {
    await _chat(tester, _watched());
    expect(find.text('Run rm -rf build?'), findsOneWidget);
    expect(_answerButton, findsNothing);
  });

  testWidgets('a controllable session from a bridge that does not say still '
      'offers Answer', (tester) async {
    await _chat(tester, controllable);
    expect(_answerButton, findsOneWidget);
    expect(_key('composer'), findsOneWidget);
  });
}
