import 'dart:async';

import 'package:broski/services/notifications/notification_tap.dart';

/// Where every notification tap arrives, whichever way it was raised: the
/// local notification plugin's callback is static and the platform channel is
/// a source of its own, so both put the tap here and a provider reads it.
///
/// A tap that comes before anyone listens is kept for the first listener: a
/// notification that launched the app is tapped before any screen exists.
final class NotificationTapRelay {
  NotificationTapRelay();

  static final NotificationTapRelay instance = NotificationTapRelay();

  late final StreamController<NotificationTap> _taps =
      StreamController<NotificationTap>.broadcast(onListen: _hand);
  NotificationTap? _unheard;

  /// The taps from the moment of listening, after the one that came before.
  Stream<NotificationTap> get taps => _taps.stream;

  /// A raw payload from a source; anything that names no session is ignored.
  void add(Object? payload) {
    final tap = NotificationTap.parse(payload);
    if (tap == null) return;
    if (_taps.hasListener) {
      _taps.add(tap);
    } else {
      _unheard = tap;
    }
  }

  void _hand() {
    final unheard = _unheard;
    if (unheard == null) return;
    _unheard = null;
    scheduleMicrotask(() => _taps.add(unheard));
  }
}
