import 'package:broski/providers/chat/chat_run_state.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat/stop_generation.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

void main() {
  testWidgets('Stop on a Pi chat sends pi_abort and leaves the running state '
      'before the bridge answers', (tester) async {
    final socket = FakeWebSocket();
    final chat = ChatSessionNotifier(BridgeService(socket));
    chat.setPiSession(sessionId: 'pi-1', cwd: '/work/repo');
    chat.setPiStreaming(true);
    addTearDown(socket.close);
    late WidgetRef widgetRef;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          chatSessionProvider.overrideWith((ref) => chat),
          bridgeServiceProvider.overrideWithValue(BridgeService(socket)),
          piBridgeServiceProvider.overrideWithValue(PiBridgeService(socket)),
        ],
        child: Consumer(
          builder: (context, ref, _) {
            widgetRef = ref;
            return const SizedBox();
          },
        ),
      ),
    );
    expect(chatIsRunning(chat.state), isTrue);

    stopGeneration(
      ref: widgetRef,
      isClaudeCode: false,
      isCodex: false,
      isPi: true,
      sessionId: 'pi-1',
      projectPath: '/work/repo',
    );

    expect(
      socket.sent.where((message) => message['type'] == 'pi_abort'),
      hasLength(1),
    );
    expect(chatIsRunning(chat.state), isFalse);

    socket.deliver({
      'type': 'pi_aborted',
      'data': true,
      'requestId': socket.lastRequestId,
    });
    await tester.pump();
  });
}
