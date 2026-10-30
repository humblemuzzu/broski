import 'dart:async';

import 'package:broski/services/notifications/native_notification_taps.dart';
import 'package:broski/services/notifications/notification_tap.dart';
import 'package:broski/services/notifications/notification_tap_relay.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Where taps come from: the relay every source puts them in.
final notificationTapRelayProvider = Provider<NotificationTapRelay>(
  (ref) => NotificationTapRelay.instance,
);

/// Starts the platform's source of taps; a test overrides it with nothing.
final notificationTapSourceProvider = Provider<Future<void> Function()>((ref) {
  final native = NativeNotificationTaps(
    ref.watch(notificationTapRelayProvider),
  );
  ref.onDispose(native.dispose);
  return native.start;
});

/// The tap that has not opened anything yet. A tap stays until [consume] says
/// it was dealt with, so one that comes before the app can act on it waits.
final class PendingNotificationTap extends StateNotifier<NotificationTap?> {
  PendingNotificationTap(
    NotificationTapRelay relay,
    Future<void> Function() start,
  ) : super(null) {
    _subscription = relay.taps.listen((tap) => state = tap);
    unawaited(start());
  }

  late final StreamSubscription<NotificationTap> _subscription;

  /// Takes `tap` off; false when a newer one has replaced it or it was
  /// already taken.
  bool consume(NotificationTap tap) {
    if (state != tap) return false;
    state = null;
    return true;
  }

  @override
  void dispose() {
    unawaited(_subscription.cancel());
    super.dispose();
  }
}

final pendingNotificationTapProvider =
    StateNotifierProvider<PendingNotificationTap, NotificationTap?>(
      (ref) => PendingNotificationTap(
        ref.watch(notificationTapRelayProvider),
        ref.watch(notificationTapSourceProvider),
      ),
    );
