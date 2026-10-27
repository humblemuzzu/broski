import 'package:broski/providers/notifications/chat_presence.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('stacked chat screens keep the chat open until the last one closes', () {
    final presence = ChatPresence();

    presence.opened();
    presence.opened();
    presence.closed();
    expect(presence.isChatOpen, isTrue);

    presence.closed();
    expect(presence.isChatOpen, isFalse);
  });

  test('closing more often than opening never leaves the count negative', () {
    final presence = ChatPresence()..closed();

    presence.opened();

    expect(presence.isChatOpen, isTrue);
  });
}
