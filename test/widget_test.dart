import 'package:flutter_test/flutter_test.dart';

import 'package:broski/models/connection.dart';

void main() {
  test('ConnectionInfo parses QR payload', () {
    const payload = '{"l":"192.168.1.20","t":"100.64.0.1","p":18274,"v":"0.1.0"}';
    final info = ConnectionInfo.parseQrPayload(payload);

    expect(info, isNotNull);
    expect(info?.localIP, '192.168.1.20');
    expect(info?.tailscaleIP, '100.64.0.1');
    expect(info?.port, 18274);
  });
}
