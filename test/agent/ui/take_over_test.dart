import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

const _watchOnly = SessionCapabilities(
  controllable: false,
  compact: false,
  cancelQueued: false,
);

final _takeOverOffered = Capabilities.fromJson({
  ...everything.toJson(),
  'backendOps': ['navigate_tree', 'take_over'],
});

Future<WidgetRig> _chat(
  WidgetTester tester, {
  required SessionCapabilities session,
}) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final rig = WidgetRig(capabilities: _takeOverOffered, session: session);
  addTearDown(rig.dispose);
  await rig.pump(tester, const AgentChatScreen(session: sessionRef));
  return rig;
}

Finder _key(String key) => find.byKey(ValueKey(key));

/// Taps and lets the sheet or dialog it opens finish sliding in.
Future<void> _tap(WidgetTester tester, Finder target) async {
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a session that can only be watched offers to take it over, '
      'and says that no terminal may be using it', (tester) async {
    final rig = await _chat(tester, session: _watchOnly);
    rig.bridge.on<BackendCallRequest>(
      (request) => BackendCallResponse(
        requestId: request.requestId,
        result: const BackendCallAccepted(result: TakenOver()),
      ),
    );

    await _tap(tester, _key('chat-panels'));
    await _tap(tester, _key('panel:take_over'));
    expect(
      find.textContaining('Make sure no terminal is using this session'),
      findsOneWidget,
    );
    expect(rig.link.sent.whereType<BackendCallRequest>(), isEmpty);

    await _tap(tester, find.text('Take over'));
    final call = rig.sent<BackendCallRequest>().call;
    expect(
      call,
      isA<PiCall>().having(
        (call) => call.op,
        'op',
        const TakeOverOp(sessionId: 's1'),
      ),
    );
    expect(find.text('This session now runs from your phone.'), findsOneWidget);
  });

  testWidgets('cancelling the question sends nothing', (tester) async {
    final rig = await _chat(tester, session: _watchOnly);
    await _tap(tester, _key('chat-panels'));
    await _tap(tester, _key('panel:take_over'));
    await _tap(tester, find.text('Cancel'));
    expect(rig.link.sent.whereType<BackendCallRequest>(), isEmpty);
  });

  testWidgets('a session that can be driven is not offered to be taken over', (
    tester,
  ) async {
    await _chat(tester, session: controllable);
    await _tap(tester, _key('chat-panels'));
    expect(_key('panel:take_over'), findsNothing);
  });
}
