import 'package:flutter_test/flutter_test.dart';
import 'package:broski/models/connection.dart';

void main() {
  group('ConnectionInfo.sameIdentity', () {
    test('matches identical connection targets', () {
      const first = ConnectionInfo(
        localIP: '192.168.1.10',
        tailscaleIP: '100.70.1.2',
        magicDNSHostname: 'mac.ts.net',
        funnelURL: 'https://mac.ts.net',
        hotspotIP: '172.20.10.1',
        port: 18274,
        authToken: 'token-a',
        tlsEnabled: true,
        certSha256: 'abc',
      );
      const second = ConnectionInfo(
        localIP: '192.168.1.10',
        tailscaleIP: '100.70.1.2',
        magicDNSHostname: 'mac.ts.net',
        funnelURL: 'https://mac.ts.net',
        hotspotIP: '172.20.10.1',
        port: 18274,
        authToken: 'token-a',
        tlsEnabled: true,
        certSha256: 'abc',
      );

      expect(first.sameIdentity(second), isTrue);
    });

    test('treats a new token as a new connection identity', () {
      const first = ConnectionInfo(
        localIP: '192.168.1.10',
        port: 18274,
        authToken: 'token-a',
      );
      const second = ConnectionInfo(
        localIP: '192.168.1.10',
        port: 18274,
        authToken: 'token-b',
      );

      expect(first.sameIdentity(second), isFalse);
    });

    test('matches when all optional fields are null', () {
      const first = ConnectionInfo(port: 18274);
      const second = ConnectionInfo(port: 18274);

      expect(first.sameIdentity(second), isTrue);
    });

    test('treats a version-only difference as the same identity', () {
      const first = ConnectionInfo(port: 18274, version: '1.0');
      const second = ConnectionInfo(port: 18274, version: '2.0');

      expect(first.sameIdentity(second), isTrue);
    });
  });
}
