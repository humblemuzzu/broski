import 'package:broski/providers/chat/chat_run_state.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat/stop_generation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

typedef _Harness = ({
  FakeWebSocket socket,
  ChatSessionNotifier chat,
  WidgetRef ref,
});

/// A chat provider over a [FakeWebSocket] that never answers, behind a widget tree that hands out its [WidgetRef].
Future<_Harness> _pump(WidgetTester tester) async {
  final socket = FakeWebSocket();
  final chat = ChatSessionNotifier(BridgeService(socket));
  addTearDown(socket.close);
  late WidgetRef ref;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        chatSessionProvider.overrideWith((ref) => chat),
        bridgeServiceProvider.overrideWithValue(BridgeService(socket)),
      ],
      child: Consumer(
        builder: (context, widgetRef, _) {
          ref = widgetRef;
          return const SizedBox();
        },
      ),
    ),
  );
  return (socket: socket, chat: chat, ref: ref);
}

void _stop(_Harness harness) => stopGeneration(ref: harness.ref);

Iterable<Map<String, dynamic>> _sent(_Harness harness, String type) =>
    harness.socket.sent.where((message) => message['type'] == type);

void main() {
  testWidgets('Stop on a Claude Code chat sends cc_abort and leaves the '
      'running state', (tester) async {
    final harness = await _pump(tester);
    harness.chat.setCCSession(sessionId: 'cc-1', cwd: '/work/repo');
    harness.chat.setCCStreaming(true);
    expect(chatIsRunning(harness.chat.state), isTrue);

    _stop(harness);

    expect(_sent(harness, 'cc_abort').single['sessionId'], 'cc-1');
    expect(chatIsRunning(harness.chat.state), isFalse);
  });
}
