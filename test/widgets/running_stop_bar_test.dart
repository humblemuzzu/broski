import 'package:broski/providers/chat_provider.dart';
import 'package:broski/services/bridge_service.dart';
import 'package:broski/theme/theme.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:broski/widgets/chat/running_stop_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_websocket.dart';

Future<ChatSessionNotifier> pumpBar(
  WidgetTester tester, {
  required VoidCallback onStop,
}) async {
  final socket = FakeWebSocket();
  final chat = ChatSessionNotifier(BridgeService(socket));
  chat.setPiSession(sessionId: 'pi-1', cwd: '/work/repo');
  addTearDown(socket.close);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [chatSessionProvider.overrideWith((ref) => chat)],
      child: MaterialApp(
        theme: BroskiTheme.fromOpenCodeTheme(opencodeDarkTheme),
        home: Scaffold(body: RunningStopBar(onStop: onStop)),
      ),
    ),
  );
  return chat;
}

void main() {
  const barKey = ValueKey('running-stop-bar');
  const stopKey = ValueKey('running-stop-button');

  testWidgets('is absent while the agent is idle', (tester) async {
    await pumpBar(tester, onStop: () {});

    expect(find.byKey(barKey), findsNothing);
  });

  testWidgets('shows a Stop control for as long as the agent streams', (
    tester,
  ) async {
    var stops = 0;
    final chat = await pumpBar(tester, onStop: () => stops++);

    chat.setPiStreaming(true);
    await tester.pump();
    expect(find.byKey(barKey), findsOneWidget);

    await tester.tap(find.byKey(stopKey));
    expect(stops, 1);

    chat.setPiStreaming(false);
    await tester.pump();
    expect(find.byKey(barKey), findsNothing);
  });

  testWidgets('cancelling the run locally takes the bar away', (tester) async {
    final chat = await pumpBar(tester, onStop: () {});
    chat.setPiStreaming(true);
    await tester.pump();

    chat.cancelRunLocally();
    await tester.pump();

    expect(find.byKey(barKey), findsNothing);
  });
}
