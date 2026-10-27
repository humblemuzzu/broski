import 'package:broski/app/app_messenger.dart';

/// What a connect that never reached the link reads as.
///
/// The link's own retries are silent — it is still connected to the machine and
/// will get there. This is the failure before that, where nothing is dialling,
/// so the user has to know why the app is not connected.
String linkConnectFailureText(Object error) {
  final clean = _withoutPrefix('$error');
  return clean.isEmpty
      ? "Couldn't open the link to your Mac"
      : "Couldn't open the link to your Mac · $clean";
}

/// `FormatException: x` and `Bad state: x` both read as `x`.
String _withoutPrefix(String detail) {
  var clean = detail.trim();
  for (final prefix in _prefixes) {
    clean = clean.replaceFirst(prefix, '').trim();
  }
  return clean;
}

final _prefixes = <RegExp>[
  RegExp(r'^[A-Za-z]*Exception: ?'),
  RegExp(r'^Bad state: ?'),
];

void showLinkConnectFailure(Object error) =>
    showAppNotice(linkConnectFailureText(error));
