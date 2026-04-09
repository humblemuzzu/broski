import 'package:broski/providers/connection/connection_error_policy.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('blocksAutoReconnect', () {
    test('blocks when user is not entitled', () {
      expect(
        blocksAutoReconnect(
          entitled: false,
          error: null,
        ),
        isTrue,
      );
    });

    test('blocks hard auth errors that require a rescan', () {
      expect(
        blocksAutoReconnect(
          entitled: true,
          error: 'Authentication failed. Scan a new QR code.',
        ),
        isTrue,
      );
      expect(
        blocksAutoReconnect(
          entitled: true,
          error:
              'Secure connection failed (certificate mismatch). Scan a new QR code.',
        ),
        isTrue,
      );
    });

    test('allows reconnect for entitled user with no error', () {
      expect(
        blocksAutoReconnect(
          entitled: true,
          error: null,
        ),
        isFalse,
      );
    });

    test('allows reconnect for transient transport errors', () {
      expect(
        blocksAutoReconnect(
          entitled: true,
          error: 'Connection timeout',
        ),
        isFalse,
      );
    });
  });
}
