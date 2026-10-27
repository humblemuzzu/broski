import 'package:broski/services/link/link_session_starter.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// How the controller starts a link. Overridden in tests with a session that
/// answers without a machine, an isolate or the native library.
final linkSessionStarterProvider = Provider<LinkSessionStarter>(
  (ref) => startLinkSession,
);
