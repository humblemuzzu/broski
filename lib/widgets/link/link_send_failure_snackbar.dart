import 'package:broski_link/broski_link.dart';
import 'package:flutter/material.dart';

/// The app's messenger, so a refusal decided outside the widget tree reaches
/// the user through the screen they are on.
final GlobalKey<ScaffoldMessengerState> appMessengerKey =
    GlobalKey<ScaffoldMessengerState>();

const Duration _noticeDuration = Duration(seconds: 4);

/// What a refused message reads as: the send never left the phone, so the user
/// has to know before they wait for a reply.
String linkSendFailureText(LinkSendFailure failure) => switch (failure.reason) {
  LinkSendFailureReason.tooLarge => 'That message is too large to send',
  LinkSendFailureReason.queueFull ||
  LinkSendFailureReason.rejected ||
  LinkSendFailureReason.sessionReset =>
    "Couldn't send — the connection to your Mac is busy, try again",
};

void showLinkSendFailure(LinkSendFailure failure) {
  final messenger = appMessengerKey.currentState;
  if (messenger == null) return;
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(linkSendFailureText(failure)),
        duration: _noticeDuration,
      ),
    );
}
