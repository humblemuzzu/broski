import 'package:broski/services/turn_notification_policy.dart';
import 'package:flutter_test/flutter_test.dart';

bool notifies({
  bool appInForeground = true,
  bool chatOpen = true,
  String? openChatSessionId = 'pi-1',
  String finishedSessionId = 'pi-1',
}) => shouldNotifyTurnFinished(
  appInForeground: appInForeground,
  chatOpen: chatOpen,
  openChatSessionId: openChatSessionId,
  finishedSessionId: finishedSessionId,
);

void main() {
  group('shouldNotifyTurnFinished', () {
    test('is silent while the user is looking at the chat that finished', () {
      expect(notifies(), isFalse);
    });

    test('notifies when the app is in the background', () {
      expect(notifies(appInForeground: false), isTrue);
    });

    test('notifies when no chat is open', () {
      expect(notifies(chatOpen: false), isTrue);
    });

    test('notifies when the open chat is another session', () {
      expect(notifies(openChatSessionId: 'pi-2'), isTrue);
    });

    test('notifies when the open chat is still a draft', () {
      expect(notifies(openChatSessionId: null), isTrue);
    });
  });
}
