import 'package:broski/providers/connection/connection_error_policy.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('blocksAutoReconnect', () {
    test('blocks hard auth errors that require a rescan', () {
      expect(
        blocksAutoReconnect(
          error: 'Authentication failed. Scan a new QR code.',
        ),
        isTrue,
      );
      expect(
        blocksAutoReconnect(
          error:
              'Secure connection failed (certificate mismatch). Scan a new QR code.',
        ),
        isTrue,
      );
    });

    test('allows reconnect with no error', () {
      expect(blocksAutoReconnect(error: null), isFalse);
    });

    test('allows reconnect for transient transport errors', () {
      expect(blocksAutoReconnect(error: 'Connection timeout'), isFalse);
    });
  });
}
