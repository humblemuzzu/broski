import 'package:flutter/material.dart';

/// The app's messenger, so a notice decided outside the widget tree — a
/// provider, a hydrate — reaches the user through the screen they are on.
final GlobalKey<ScaffoldMessengerState> appMessengerKey =
    GlobalKey<ScaffoldMessengerState>();

const Duration _noticeDuration = Duration(seconds: 4);

/// Shows [message] on whatever screen is up; nothing when none is.
///
/// [onRetry] turns the notice into an offer to try the failed read again, instead of a report that
/// leaves the user with nothing to do about it.
void showAppNotice(
  String message, {
  VoidCallback? onRetry,
  String retryLabel = 'Retry',
}) {
  final messenger = appMessengerKey.currentState;
  if (messenger == null) return;
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        duration: _noticeDuration,
        action: onRetry == null
            ? null
            : SnackBarAction(label: retryLabel, onPressed: onRetry),
      ),
    );
}
