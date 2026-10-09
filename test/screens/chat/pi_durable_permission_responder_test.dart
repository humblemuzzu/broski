import 'package:broski/models/pi_durable/pi_durable_payloads.dart';
import 'package:flutter_test/flutter_test.dart';

/// The permission card answers with `once` / `always` / `reject`; the durable
/// backend only understands `allow` / `deny`.
void main() {
  group('permission response mapping', () {
    test('once and always mean allow, reject means deny', () {
      expect(piDurableDecisionForPermissionResponse('once'), 'allow');
      expect(piDurableDecisionForPermissionResponse('always'), 'allow');
      expect(piDurableDecisionForPermissionResponse('reject'), 'deny');
    });

    test('anything else has no decision, so nothing is sent', () {
      expect(piDurableDecisionForPermissionResponse('maybe'), isNull);
      expect(piDurableDecisionForPermissionResponse(''), isNull);
      expect(
        buildPiDurablePermissionResponse(
          sessionId: 's-1',
          requestId: 's-1:call-1',
          response: 'maybe',
        ),
        isNull,
      );
    });
  });

  group('pd_permission_response payload', () {
    test('round-trips the bridge permission id untouched', () {
      final payload = buildPiDurablePermissionResponse(
        sessionId: 's-1',
        requestId: 's-1:call-1',
        response: 'once',
      );
      expect(payload, {
        'type': 'pd_permission_response',
        'sessionId': 's-1',
        'requestId': 's-1:call-1',
        'decision': 'allow',
      });
    });

    test('a rejection reason rides along, an empty one does not', () {
      expect(
        buildPiDurablePermissionResponse(
          sessionId: 's-1',
          requestId: 's-1:call-2',
          response: 'reject',
          reason: 'not this file',
        ),
        {
          'type': 'pd_permission_response',
          'sessionId': 's-1',
          'requestId': 's-1:call-2',
          'decision': 'deny',
          'reason': 'not this file',
        },
      );
      expect(
        buildPiDurablePermissionResponse(
          sessionId: 's-1',
          requestId: 's-1:call-2',
          response: 'reject',
          reason: '',
        )!.containsKey('reason'),
        isFalse,
      );
    });
  });
}
