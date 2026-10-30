import 'package:broski/services/notifications/native_notification_taps.dart';
import 'package:broski/services/notifications/notification_tap.dart';
import 'package:broski/services/notifications/notification_tap_relay.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('broski/notification_taps');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test(
    'the tap that launched the app is taken when the source starts',
    () async {
      messenger.setMockMethodCallHandler(
        channel,
        (call) async => call.method == 'takeTap'
            ? {'backend': 'pi', 'session': 's-1', 'request': 'i-1'}
            : null,
      );
      final relay = NotificationTapRelay();
      final heard = <NotificationTap>[];
      final subscription = relay.taps.listen(heard.add);
      final native = NativeNotificationTaps(relay);
      await native.start();
      await Future<void>.delayed(Duration.zero);

      expect(heard, [
        const NotificationTap(backend: 'pi', session: 's-1', request: 'i-1'),
      ]);
      native.dispose();
      await subscription.cancel();
    },
  );

  test('a tap made while the app runs arrives as the platform calls', () async {
    messenger.setMockMethodCallHandler(channel, (call) async => null);
    final relay = NotificationTapRelay();
    final heard = <NotificationTap>[];
    final subscription = relay.taps.listen(heard.add);
    final native = NativeNotificationTaps(relay);
    await native.start();
    expect(heard, isEmpty);

    await messenger.handlePlatformMessage(
      channel.name,
      channel.codec.encodeMethodCall(
        const MethodCall('onTap', {'backend': 'pi', 'session': 's-2'}),
      ),
      (_) {},
    );

    expect(heard.map((tap) => tap.session), ['s-2']);
    native.dispose();
    await subscription.cancel();
  });

  test('a platform without the channel gives no tap and no error', () async {
    final relay = NotificationTapRelay();
    final heard = <NotificationTap>[];
    final subscription = relay.taps.listen(heard.add);
    await NativeNotificationTaps(relay).start();
    expect(heard, isEmpty);
    await subscription.cancel();
  });
}
