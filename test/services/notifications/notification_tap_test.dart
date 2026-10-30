import 'package:broski/services/notifications/notification_tap.dart';
import 'package:broski/services/notifications/notification_tap_relay.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('NotificationTap.parse', () {
    test('reads what a push names, from the map the platform hands over', () {
      expect(
        NotificationTap.parse({
          'backend': 'pi',
          'session': 's-1',
          'request': 'i-9',
        }),
        const NotificationTap(backend: 'pi', session: 's-1', request: 'i-9'),
      );
      expect(
        NotificationTap.parse({'backend': 'pi', 'session': 's-1'}),
        const NotificationTap(backend: 'pi', session: 's-1'),
      );
    });

    test(
      'reads the JSON payload of a local notification and writes it back',
      () {
        const tap = NotificationTap(
          backend: 'pi',
          session: 's-1',
          request: 'r',
        );
        expect(NotificationTap.parse(tap.toPayload()), tap);
      },
    );

    test('names nothing when backend or session is missing or empty', () {
      expect(NotificationTap.parse({'backend': 'pi'}), isNull);
      expect(NotificationTap.parse({'session': 's-1'}), isNull);
      expect(NotificationTap.parse({'backend': '', 'session': 's'}), isNull);
      expect(NotificationTap.parse({'backend': 'pi', 'session': ''}), isNull);
      expect(NotificationTap.parse({'backend': 1, 'session': 's'}), isNull);
    });

    test('ignores the plain session id older local notifications carry', () {
      expect(NotificationTap.parse('ses_123'), isNull);
      expect(NotificationTap.parse('[1,2]'), isNull);
      expect(NotificationTap.parse(null), isNull);
      expect(NotificationTap.parse(7), isNull);
    });
  });

  group('NotificationTapRelay', () {
    const tap = {'backend': 'pi', 'session': 's-1'};

    test(
      'keeps a tap that came before anyone listened for the first listener',
      () async {
        final relay = NotificationTapRelay()..add(tap);
        final heard = <NotificationTap>[];
        final subscription = relay.taps.listen(heard.add);
        await Future<void>.delayed(Duration.zero);
        expect(heard, [NotificationTap.parse(tap)]);
        await subscription.cancel();
      },
    );

    test(
      'hands a tap to a listener once, and later ones as they come',
      () async {
        final relay = NotificationTapRelay()..add(tap);
        final first = <NotificationTap>[];
        final firstSub = relay.taps.listen(first.add);
        await Future<void>.delayed(Duration.zero);
        final second = <NotificationTap>[];
        final secondSub = relay.taps.listen(second.add);
        relay.add({'backend': 'pi', 'session': 's-2'});
        await Future<void>.delayed(Duration.zero);
        expect(first.map((tap) => tap.session), ['s-1', 's-2']);
        expect(second.map((tap) => tap.session), ['s-2']);
        await firstSub.cancel();
        await secondSub.cancel();
      },
    );

    test('drops a payload that names no session', () async {
      final relay = NotificationTapRelay()..add('ses_123');
      final heard = <NotificationTap>[];
      final subscription = relay.taps.listen(heard.add);
      await Future<void>.delayed(Duration.zero);
      expect(heard, isEmpty);
      await subscription.cancel();
    });
  });
}
