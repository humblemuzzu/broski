import 'package:broski/models/pi_bash_card.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/screens/chat/pi_bang_command.dart';
import 'package:broski/services/bridge_service.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

void main() {
  test(
    'a mid-command disconnect fails the card and frees the composer',
    () async {
      final socket = FakeWebSocket();
      addTearDown(socket.close);
      final bridge = PiBridgeService(socket);
      addTearDown(bridge.dispose);
      final notifier = ChatSessionNotifier(BridgeService(socket));
      notifier.setPiSession(sessionId: 'pi-1', cwd: '/tmp/work');

      final messageId = notifier.appendPiBashCommand(
        command: 'sleep 300',
        excludeFromContext: false,
        sessionId: 'pi-1',
      );
      expect(hasRunningPiBashCommand(notifier.state.messages, 'pi-1'), isTrue);

      final running = executePiBangCommand(
        bridge: bridge,
        notifier: notifier,
        messageId: messageId,
        command: 'sleep 300',
        excludeFromContext: false,
        cwd: '/tmp/work',
      );

      socket.drop();
      await running;

      expect(hasRunningPiBashCommand(notifier.state.messages, 'pi-1'), isFalse);
      final card = notifier.state.messages.single;
      expect(
        card.metadata[PiBashCardKeys.error],
        'Connection lost — command may still be running on your Mac',
      );
      expect(card.metadata[PiBashCardKeys.status], PiBashStatus.finished);
    },
  );
}
