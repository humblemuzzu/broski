import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat/pi_durable_chat_actions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

void main() {
  testWidgets('a rejected pd_chat marks the prompt failed and the retry '
      'reuses its requestId', (tester) async {
    final socket = FakeWebSocket();
    addTearDown(socket.close);
    late WidgetRef ref;

    await tester.pumpWidget(
      ProviderScope(
        overrides: [webSocketServiceProvider.overrideWithValue(socket)],
        child: Consumer(
          builder: (context, widgetRef, _) {
            ref = widgetRef;
            return const SizedBox.shrink();
          },
        ),
      ),
    );

    ref
        .read(chatSessionProvider.notifier)
        .setPiDurableSession(sessionId: 'pd-1', cwd: '/tmp/work');

    expect(
      sendPiDurableMessage(ref: ref, text: 'hello', attachedFiles: const []),
      isTrue,
    );
    final messageId = ref.read(chatSessionProvider).messages.single.id;
    expect(socket.lastRequestId, messageId);
    expect(
      ref.read(chatSessionProvider).messages.single.metadata['deliveryState'],
      'pending',
    );

    socket.deliver({
      'type': 'error',
      'requestId': messageId,
      'message': 'bridge rejected the prompt',
    });
    await tester.pump();

    expect(
      ref.read(chatSessionProvider).messages.single.metadata['deliveryState'],
      'failed',
    );
    expect(ref.read(chatSessionProvider).pdIsStreaming, isFalse);

    final retry = retryPiDurableMessage(ref: ref, messageId: messageId);
    expect(
      ref.read(chatSessionProvider).messages.single.metadata['deliveryState'],
      'pending',
    );

    final chats = socket.sent.where((m) => m['type'] == 'pd_chat').toList();
    expect(chats, hasLength(2));
    expect(chats.map((m) => m['requestId']), [messageId, messageId]);
    expect(chats.last['content'], 'hello');

    socket.deliver({
      'type': 'pd_chat_accepted',
      'requestId': messageId,
      'data': {'submissionId': 7},
    });
    await retry;
    await tester.pump();

    expect(
      ref.read(chatSessionProvider).messages.single.metadata['deliveryState'],
      'pending',
    );
  });
}
