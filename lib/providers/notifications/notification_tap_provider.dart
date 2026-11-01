import 'dart:async';

import 'package:broski/agent/agent_providers.dart' show agentClockProvider;
import 'package:broski/agent/client/agent_clock.dart';
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
/// it was dealt with, so one that comes before the app can act on it waits,
/// but no longer than [maxWait]: a tap is a wish to see the session now, and
/// one the app could not act on by then (no link, no saved list of backends)
/// would open long after, out of nowhere.
final class PendingNotificationTap extends StateNotifier<NotificationTap?> {
  PendingNotificationTap(
    NotificationTapRelay relay,
    Future<void> Function() start,
    this._clock,
  ) : super(null) {
    _subscription = relay.taps.listen(_arrived);
    unawaited(start());
  }

  static const maxWait = Duration(seconds: 30);

  final AgentClock _clock;
  late final StreamSubscription<NotificationTap> _subscription;
  void Function()? _cancelExpiry;
  NotificationTap? _switchedFor;

  void _arrived(NotificationTap tap) {
    _cancelExpiry?.call();
    state = tap;
    _cancelExpiry = _clock.after(maxWait, () => consume(tap));
  }

  /// Takes `tap` off; false when a newer one has replaced it or it was
  /// already taken.
  bool consume(NotificationTap tap) {
    if (state != tap) return false;
    _cancelExpiry?.call();
    _cancelExpiry = null;
    state = null;
    return true;
  }

  /// True the first time it is asked for the pending `tap`: the app moves to
  /// the tap's machine once, however often it rebuilds while it does.
  bool claimSwitch(NotificationTap tap) {
    if (state != tap || _switchedFor == tap) return false;
    _switchedFor = tap;
    return true;
  }

  @override
  void dispose() {
    _cancelExpiry?.call();
    unawaited(_subscription.cancel());
    super.dispose();
  }
}

final pendingNotificationTapProvider =
    StateNotifierProvider<PendingNotificationTap, NotificationTap?>(
      (ref) => PendingNotificationTap(
        ref.watch(notificationTapRelayProvider),
        ref.watch(notificationTapSourceProvider),
        ref.watch(agentClockProvider),
      ),
    );
