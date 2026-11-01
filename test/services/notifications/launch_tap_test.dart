import 'package:broski/services/notifications/launch_tap.dart';
import 'package:broski/services/notifications/notification_tap.dart';
import 'package:broski/services/notifications/notification_tap_relay.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';

Future<List<NotificationTap>> _heard(NotificationTapRelay relay) async {
  final heard = <NotificationTap>[];
  final subscription = relay.taps.listen(heard.add);
  await Future<void>.delayed(Duration.zero);
  await subscription.cancel();
  return heard;
}

NotificationAppLaunchDetails _launch({required bool byNotification}) =>
    NotificationAppLaunchDetails(
      byNotification,
      notificationResponse: const NotificationResponse(
        notificationResponseType: NotificationResponseType.selectedNotification,
        payload: '{"backend":"pi","session":"s-1","machine":"mac-1"}',
      ),
    );

void main() {
  test('a local notification whose tap launched the app reaches the relay, '
      'with its machine', () async {
    final relay = NotificationTapRelay();
    relayLaunchTap(_launch(byNotification: true), relay);
    expect(await _heard(relay), [
      const NotificationTap(backend: 'pi', session: 's-1', machine: 'mac-1'),
    ]);
  });

  test('a launch no notification made hands nothing over', () async {
    final relay = NotificationTapRelay();
    relayLaunchTap(_launch(byNotification: false), relay);
    relayLaunchTap(null, relay);
    expect(await _heard(relay), isEmpty);
  });
}
