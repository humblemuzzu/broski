import 'package:broski/services/notifications/notification_tap_relay.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// A local notification whose tap launched the app reaches no tap callback:
/// the plugin keeps it in its launch details, and this hands it to [relay].
void relayLaunchTap(
  NotificationAppLaunchDetails? details,
  NotificationTapRelay relay,
) {
  if (details == null || !details.didNotificationLaunchApp) return;
  relay.add(details.notificationResponse?.payload);
}
