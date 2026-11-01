import 'package:broski/providers/notifications/notification_tap_provider.dart';
import 'package:broski/services/notifications/notification_tap.dart';
import 'package:broski/services/notifications/notification_tap_relay.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/manual_clock.dart';

void main() {
  const older = NotificationTap(backend: 'pi', session: 'older');
  const newer = NotificationTap(backend: 'pi', session: 'newer');

  test('a tap a newer one replaced cannot take the newer one off', () async {
    final relay = NotificationTapRelay();
    final pending = PendingNotificationTap(relay, () async {}, ManualClock());
    addTearDown(pending.dispose);
    relay
      ..add(older.toPayload())
      ..add(newer.toPayload());
    await pumpEventQueue();
    expect(pending.consume(older), isFalse);
    expect(pending.state, newer);
    expect(pending.consume(newer), isTrue);
    expect(pending.consume(newer), isFalse);
  });

  test('a newer tap waits its own half minute', () async {
    final clock = ManualClock();
    final relay = NotificationTapRelay();
    final pending = PendingNotificationTap(relay, () async {}, clock);
    addTearDown(pending.dispose);
    relay.add(older.toPayload());
    await pumpEventQueue();
    await clock.advance(const Duration(seconds: 20));
    relay.add(newer.toPayload());
    await pumpEventQueue();
    await clock.advance(const Duration(seconds: 20));
    expect(pending.state, newer);
    await clock.advance(const Duration(seconds: 10));
    expect(pending.state, isNull);
  });
}
