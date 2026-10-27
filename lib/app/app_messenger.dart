import 'package:flutter/material.dart';

/// The app's messenger, so a notice decided outside the widget tree — a
/// provider, a hydrate — reaches the user through the screen they are on.
final GlobalKey<ScaffoldMessengerState> appMessengerKey =
    GlobalKey<ScaffoldMessengerState>();

const Duration _noticeDuration = Duration(seconds: 4);

/// Shows [message] on whatever screen is up; nothing when none is.
void showAppNotice(String message) {
  final messenger = appMessengerKey.currentState;
  if (messenger == null) return;
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message), duration: _noticeDuration));
}
