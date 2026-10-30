import 'package:broski/services/notifications/notification_tap_relay.dart';
import 'package:flutter/services.dart';

/// The platform side of a tapped push: the session its notification names,
/// handed over as it is tapped and, for a tap that launched the app, when
/// this first asks.
class NativeNotificationTaps {
  NativeNotificationTaps(this._relay, {MethodChannel? channel})
    : _channel = channel ?? const MethodChannel('broski/notification_taps');

  final NotificationTapRelay _relay;
  final MethodChannel _channel;

  Future<void> start() async {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'onTap') _relay.add(call.arguments);
    });
    try {
      _relay.add(await _channel.invokeMethod<Object>('takeTap'));
    } on PlatformException catch (_) {
      return;
    } on MissingPluginException catch (_) {
      return;
    }
  }

  void dispose() => _channel.setMethodCallHandler(null);
}
