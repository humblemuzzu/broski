import 'package:broski/models/pi_durable/pi_durable_payloads.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('pd_create_session payload', () {
    test('carries cwd, requestId, model, thinking level and title', () {
      final payload = buildPiDurableCreateSession(
        cwd: '/Users/dev/app',
        requestId: 'req-1',
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'high',
        title: 'app',
      );
      expect(payload, {
        'type': 'pd_create_session',
        'cwd': '/Users/dev/app',
        'requestId': 'req-1',
        'model': {'provider': 'anthropic', 'modelId': 'claude-sonnet-4'},
        'thinkingLevel': 'high',
        'title': 'app',
      });
    });

    test('omits model, thinking level and title when unset', () {
      final payload = buildPiDurableCreateSession(
        cwd: '/Users/dev/app',
        requestId: 'req-1',
      );
      expect(payload.keys, ['type', 'cwd', 'requestId']);
    });

    test('a half-set model is not sent', () {
      final payload = buildPiDurableCreateSession(
        cwd: '/Users/dev/app',
        requestId: 'req-1',
        provider: 'anthropic',
      );
      expect(payload.containsKey('model'), isFalse);
    });
  });

  group('pd_chat payload', () {
    test('requestId is the exactly-once key and stdin is the prompt', () {
      final payload = buildPiDurableChat(
        sessionId: 's-1',
        content: 'run the tests',
        requestId: 'pd-123',
      );
      expect(payload, {
        'type': 'pd_chat',
        'sessionId': 's-1',
        'content': 'run the tests',
        'requestId': 'pd-123',
      });
    });

    test('steer sets whenBusy, a plain send does not', () {
      expect(
        buildPiDurableChat(
          sessionId: 's-1',
          content: 'no',
          requestId: 'pd-1',
          steer: true,
        )['whenBusy'],
        'steer',
      );
      expect(
        buildPiDurableChat(
          sessionId: 's-1',
          content: 'no',
          requestId: 'pd-2',
        ).containsKey('whenBusy'),
        isFalse,
      );
    });

    test('the client message id is usable as the request id', () {
      final messageId = piDurableClientMessageId(1700000000000000);
      expect(messageId, 'pd-1700000000000000');
      expect(
        buildPiDurableChat(
          sessionId: 's-1',
          content: 'hi',
          requestId: messageId,
        )['requestId'],
        messageId,
      );
    });
  });

  group('pd_get_transcript payload', () {
    test('sends limit and cursor only when set', () {
      expect(buildPiDurableGetTranscript(sessionId: 's-1', requestId: 'r-1'), {
        'type': 'pd_get_transcript',
        'sessionId': 's-1',
        'requestId': 'r-1',
      });
      expect(
        buildPiDurableGetTranscript(
          sessionId: 's-1',
          requestId: 'r-1',
          limit: 50,
          cursor: const {'entryId': 12},
        ),
        {
          'type': 'pd_get_transcript',
          'sessionId': 's-1',
          'requestId': 'r-1',
          'limit': 50,
          'cursor': const {'entryId': 12},
        },
      );
    });
  });
}
