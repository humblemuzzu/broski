import 'package:broski/screens/scan/scan_rejection.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('unsupportedQrMessage', () {
    test('names a v1 payload as an old Broski QR', () {
      expect(
        unsupportedQrMessage(
          '{"p":18274,"l":"192.168.1.5","a":"tok","s":1,"c":"AB"}',
        ),
        oldBroskiQrMessage,
      );
      expect(
        unsupportedQrMessage('{"p":"18274","t":"100.1.2.3","a":"tok"}'),
        oldBroskiQrMessage,
      );
    });

    test('gives the generic message for anything else', () {
      expect(unsupportedQrMessage('https://example.com'), notBroskiQrMessage);
      expect(unsupportedQrMessage('{"hello":"world"}'), notBroskiQrMessage);
      expect(unsupportedQrMessage('{"p":18274}'), notBroskiQrMessage);
      expect(unsupportedQrMessage('[1,2,3]'), notBroskiQrMessage);
      expect(unsupportedQrMessage(''), notBroskiQrMessage);
    });
  });

  group('ScanRejectionGate', () {
    test('admits a payload once while the camera keeps re-reading it', () {
      var now = DateTime.utc(2026, 1, 1);
      final gate = ScanRejectionGate(now: () => now);

      expect(gate.admit('qr-a'), isTrue);
      for (var frame = 0; frame < 30; frame++) {
        now = now.add(const Duration(milliseconds: 100));
        expect(gate.admit('qr-a'), isFalse);
      }
    });

    test('admits a different payload straight away', () {
      final gate = ScanRejectionGate(now: () => DateTime.utc(2026, 1, 1));

      expect(gate.admit('qr-a'), isTrue);
      expect(gate.admit('qr-b'), isTrue);
    });

    test('admits the same payload again after the quiet period', () {
      var now = DateTime.utc(2026, 1, 1);
      final gate = ScanRejectionGate(now: () => now);

      expect(gate.admit('qr-a'), isTrue);
      now = now.add(gate.quietPeriod);
      expect(gate.admit('qr-a'), isTrue);
    });
  });
}
