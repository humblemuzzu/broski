import 'package:flutter_test/flutter_test.dart';
import 'package:broski/providers/connection/connection_error_policy.dart';

void main() {
  group('blocksAutoReconnect', () {
    test('blocks when user is not entitled', () {
      expect(
        blocksAutoReconnect(
          entitled: false,
          error: null,
          licenseRetryAttempted: false,
        ),
        isTrue,
      );
    });

    test('blocks hard auth errors that require a rescan', () {
      expect(
        blocksAutoReconnect(
          entitled: true,
          error: 'Authentication failed. Scan a new QR code.',
          licenseRetryAttempted: false,
        ),
        isTrue,
      );
      expect(
        blocksAutoReconnect(
          entitled: true,
          error:
              'Secure connection failed (certificate mismatch). Scan a new QR code.',
          licenseRetryAttempted: false,
        ),
        isTrue,
      );
    });

    test('blocks license retry failures', () {
      expect(
        blocksAutoReconnect(
          entitled: true,
          error: 'Subscription required. Subscribe to Pro in Settings.',
          licenseRetryAttempted: false,
        ),
        isTrue,
      );
      expect(
        blocksAutoReconnect(
          entitled: true,
          error: null,
          licenseRetryAttempted: true,
        ),
        isTrue,
      );
    });

    test('allows reconnect for entitled user with no error', () {
      expect(
        blocksAutoReconnect(
          entitled: true,
          error: null,
          licenseRetryAttempted: false,
        ),
        isFalse,
      );
    });

    test('allows reconnect for transient transport errors', () {
      expect(
        blocksAutoReconnect(
          entitled: true,
          error: 'Connection timeout',
          licenseRetryAttempted: false,
        ),
        isFalse,
      );
    });
  });
}
