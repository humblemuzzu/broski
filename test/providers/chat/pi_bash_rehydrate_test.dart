import 'package:broski/models/message.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/pi_bash_card.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/screens/chat/pi_bang_command.dart';
import 'package:broski/services/bridge_service.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late WebSocketService socket;
  late ChatSessionNotifier notifier;

  setUp(() {
    socket = WebSocketService();
    notifier = ChatSessionNotifier(BridgeService(socket));
    notifier.setPiSession(sessionId: 'pi-1', cwd: '/tmp/work');
  });

  tearDown(() => socket.dispose());

  String startRunningCard({String command = 'sleep 300'}) =>
      notifier.appendPiBashCommand(
        command: command,
        excludeFromContext: false,
        sessionId: 'pi-1',
      );

  List<ChatMessage> bashCards() => notifier.state.messages
      .where((message) => isPiBashCard(message.metadata))
      .toList();

  group('Pi bash cards across a transcript rehydrate', () {
    test('a running ! card survives the rehydrate', () {
      final id = startRunningCard();

      notifier.hydratePiTranscript([
        {'role': 'user', 'content': 'hi'},
        {'role': 'assistant', 'text': 'hello'},
      ]);

      expect(notifier.state.messages.map((m) => m.id), contains(id));
      expect(hasRunningPiBashCommand(notifier.state.messages, 'pi-1'), isTrue);
    });

    test('the preserved card stays after the hydrated history', () {
      final id = startRunningCard();

      notifier.hydratePiTranscript([
        {'role': 'user', 'content': 'hi'},
        {'role': 'assistant', 'text': 'hello'},
      ]);

      expect(notifier.state.messages.last.id, id);
    });

    test('a finished card is left to the hydrated bashExecution entry', () {
      final id = startRunningCard();
      notifier.completePiBashCommand(
        messageId: id,
        result: const PiBashResult(output: 'ok', exitCode: 0),
      );

      notifier.hydratePiTranscript([
        {
          'role': 'bashExecution',
          'command': 'sleep 300',
          'output': 'ok',
          'exitCode': 0,
          'timestamp': 1000,
        },
      ]);

      final cards = bashCards();
      expect(cards, hasLength(1));
      expect(cards.single.id, isNot(id));
      expect(cards.single.text, 'sleep 300');
    });

    test('a running card from another session does not leak in', () {
      notifier.appendPiBashCommand(
        command: 'sleep 1',
        excludeFromContext: false,
        sessionId: 'pi-other',
      );

      notifier.hydratePiTranscript([
        {'role': 'user', 'content': 'hi'},
      ]);

      expect(bashCards(), isEmpty);
    });
  });

  group('Pi bash guards after a failed command', () {
    test('a connection-lost card stops blocking new ! commands', () {
      final id = startRunningCard();
      expect(hasRunningPiBashCommand(notifier.state.messages, 'pi-1'), isTrue);

      notifier.failPiBashCommand(
        messageId: id,
        error: 'Connection lost — command may still be running on your Mac',
      );

      expect(hasRunningPiBashCommand(notifier.state.messages, 'pi-1'), isFalse);
      expect(
        bashCards().single.metadata[PiBashCardKeys.error],
        'Connection lost — command may still be running on your Mac',
      );
    });
  });
}
