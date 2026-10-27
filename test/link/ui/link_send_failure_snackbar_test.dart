import 'package:broski/app/app_messenger.dart';
import 'package:broski/services/link/link_send_failure_notice.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('a refused message is shown to the user, not dropped', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        scaffoldMessengerKey: appMessengerKey,
        home: const Scaffold(body: SizedBox.shrink()),
      ),
    );

    showLinkSendFailure(
      const LinkSendFailure(
        reason: LinkSendFailureReason.queueFull,
        stream: 1,
        bytes: 4096,
        tag: 'req_1',
      ),
    );
    await tester.pump();

    expect(
      find.text('Your phone is still sending the last messages'),
      findsOneWidget,
    );
  });

  testWidgets('a frame nothing waits on is never announced', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        scaffoldMessengerKey: appMessengerKey,
        home: const Scaffold(body: SizedBox.shrink()),
      ),
    );

    showLinkSendFailure(
      const LinkSendFailure(
        reason: LinkSendFailureReason.rejected,
        stream: 0,
        bytes: 12,
      ),
    );
    showLinkSendFailure(
      const LinkSendFailure(
        reason: LinkSendFailureReason.sessionReset,
        stream: 1,
        bytes: 4096,
        count: 2,
        tag: 'req_2',
      ),
    );
    await tester.pump();

    expect(find.byType(SnackBar), findsNothing);
  });

  test('a message too large to carry says so', () {
    expect(
      linkSendFailureText(
        const LinkSendFailure(
          reason: LinkSendFailureReason.tooLarge,
          stream: 1,
          bytes: 9000000,
        ),
      ),
      'That message is too large to send',
    );
  });

  test('each refusal says what actually happened', () {
    expect(
      linkSendFailureText(
        const LinkSendFailure(
          reason: LinkSendFailureReason.rejected,
          stream: 1,
          bytes: 10,
        ),
      ),
      "Couldn't send — the Mac refused that message",
    );
    expect(
      linkSendFailureText(
        const LinkSendFailure(
          reason: LinkSendFailureReason.sessionReset,
          stream: 1,
          bytes: 10,
          count: 3,
        ),
      ),
      'The session was replaced · reconnecting',
    );
  });
}
