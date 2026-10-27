import 'package:broski/widgets/link/link_send_failure_snackbar.dart';
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
      ),
    );
    await tester.pump();

    expect(
      find.text(
        "Couldn't send — the connection to your Mac is busy, try again",
      ),
      findsOneWidget,
    );
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

  test('a cleared queue reads as a busy connection', () {
    for (final reason in const [
      LinkSendFailureReason.sessionReset,
      LinkSendFailureReason.rejected,
      LinkSendFailureReason.queueFull,
    ]) {
      expect(
        linkSendFailureText(
          LinkSendFailure(reason: reason, stream: 1, bytes: 10, count: 3),
        ),
        "Couldn't send — the connection to your Mac is busy, try again",
        reason: '$reason',
      );
    }
  });
}
