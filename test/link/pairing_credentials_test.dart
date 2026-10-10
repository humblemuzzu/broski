import 'dart:typed_data';

import 'package:broski/services/link/pairing_credentials.dart';
import 'package:flutter_test/flutter_test.dart';

/// The secret both sides derive from: S = 0x00, 0x01, ..., 0x1f.
final _vectorSecret = Uint8List.fromList(List.generate(32, (index) => index));

void main() {
  test('the pairing device id is the first 16 bytes of sha256(ctx || S)', () {
    expect(pairingDeviceId(_vectorSecret), '13cf11d39c68f01194167dec02ae299b');
  });

  test(
    'the pairing token is base64url without padding of sha256(ctx || S)',
    () {
      expect(
        pairingToken(_vectorSecret),
        'ftJ9gRzybv0NVMqryTFwpTALY9GjGlZ6a7MD4guui98',
      );
    },
  );

  test('the credentials are shaped the way the relay expects', () {
    expect(pairingDeviceId(_vectorSecret), hasLength(32));
    expect(pairingDeviceId(_vectorSecret), matches(RegExp(r'^[0-9a-f]{32}$')));
    expect(pairingToken(_vectorSecret), hasLength(43));
    expect(pairingToken(_vectorSecret), isNot(contains('=')));
  });

  test('a different secret gives different credentials', () {
    final other = Uint8List.fromList(List.generate(32, (index) => 255 - index));

    expect(pairingDeviceId(other), isNot(pairingDeviceId(_vectorSecret)));
    expect(pairingToken(other), isNot(pairingToken(_vectorSecret)));
  });
}
