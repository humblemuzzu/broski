import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/backends_controller.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/notifications/notification_tap_provider.dart';
import 'package:broski/services/notifications/notification_tap.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens a session's conversation; a test replaces it with a recorder.
final notificationSessionOpenerProvider =
    Provider<Future<void> Function(BuildContext, SessionRef)>(
      (ref) => openSession,
    );

/// The session a tap opens on the contract core's screens, or null when the
/// bridge does not serve its backend that way: the old protocol's sessions
/// have their own screens. Which backends the core serves is what the bridge
/// listed, not something the app knows.
SessionRef? contractSessionOf(NotificationTap tap, BackendsState backends) {
  final served = backends.backends
      .where((listed) => listed.id.wire == tap.backend)
      .firstOrNull;
  return served == null
      ? null
      : SessionRef(backend: served.id, sessionId: tap.session);
}

/// Opens the conversation a tapped notification is about. A tap waits until
/// the bridge has listed its backends; one that is not a contract session is
/// dropped. Called from a widget's `build`, under the app's navigator.
void routeNotificationTaps(BuildContext context, WidgetRef ref) {
  final tap = ref.watch(pendingNotificationTapProvider);
  if (tap == null) return;
  final backends = ref.watch(backendsProvider);
  if (!backends.loaded) return;
  final session = contractSessionOf(tap, backends);
  final open = ref.read(notificationSessionOpenerProvider);
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!context.mounted) return;
    final taken = ref
        .read(pendingNotificationTapProvider.notifier)
        .consume(tap);
    if (taken && session != null) open(context, session);
  });
}
