import 'package:broski/models/pi.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('PiState.fromJson', () {
    test('parses a full bridge payload', () {
      final state = PiState.fromJson(<String, dynamic>{
        'model': <String, dynamic>{
          'id': 'claude-sonnet-4',
          'name': 'Claude Sonnet 4',
          'provider': 'anthropic',
          'api': 'anthropic-messages',
          'contextWindow': 200000,
          'maxTokens': 8192,
          'reasoning': true,
          'input': <String>['text', 'image'],
          'cost': <String, dynamic>{
            'input': 3,
            'output': 15,
            'cacheRead': 0.3,
            'cacheWrite': 3.75,
          },
          'authenticated': true,
          'isOAuth': false,
        },
        'thinkingLevel': 'high',
        'isStreaming': true,
        'isCompacting': false,
        'isRetrying': true,
        'sessionFile': '/tmp/pi/session.jsonl',
        'sessionId': 'pi-1',
        'sessionName': 'My session',
        'steeringMode': 'one-at-a-time',
        'followUpMode': 'one-at-a-time',
        'autoCompactionEnabled': false,
        'autoRetryEnabled': true,
        'messageCount': 12,
        'pendingMessageCount': 3,
        'isBashRunning': true,
        'hasPendingBashMessages': true,
        'retryAttempt': 2,
      });

      expect(state.model?.id, 'claude-sonnet-4');
      expect(state.model?.modelRef, 'anthropic/claude-sonnet-4');
      expect(state.model?.supportsImages, isTrue);
      expect(state.model?.contextWindow, 200000);
      expect(state.model?.cost.output, 15);
      expect(state.thinkingLevel, PiThinkingLevel.high);
      expect(state.isStreaming, isTrue);
      expect(state.isCompacting, isFalse);
      expect(state.isRetrying, isTrue);
      expect(state.sessionFile, '/tmp/pi/session.jsonl');
      expect(state.sessionId, 'pi-1');
      expect(state.sessionName, 'My session');
      expect(state.steeringMode, 'one-at-a-time');
      expect(state.followUpMode, 'one-at-a-time');
      expect(state.autoCompactionEnabled, isFalse);
      expect(state.autoRetryEnabled, isTrue);
      expect(state.messageCount, 12);
      expect(state.pendingMessageCount, 3);
      expect(state.isBashRunning, isTrue);
      expect(state.hasPendingBashMessages, isTrue);
      expect(state.retryAttempt, 2);
    });

    test('falls back to defaults when the bridge omits optional fields', () {
      final state = PiState.fromJson(const <String, dynamic>{});

      expect(state.model, isNull);
      expect(state.thinkingLevel, PiThinkingLevel.medium);
      expect(state.isStreaming, isFalse);
      expect(state.isCompacting, isFalse);
      expect(state.isRetrying, isFalse);
      expect(state.sessionFile, isNull);
      expect(state.sessionId, '');
      expect(state.sessionName, isNull);
      expect(state.steeringMode, 'all');
      expect(state.followUpMode, 'all');
      expect(state.autoCompactionEnabled, isTrue);
      expect(state.autoRetryEnabled, isTrue);
      expect(state.messageCount, 0);
      expect(state.pendingMessageCount, 0);
      expect(state.isBashRunning, isFalse);
      expect(state.hasPendingBashMessages, isFalse);
      expect(state.retryAttempt, 0);
    });

    test('treats an explicit null model as absent', () {
      final state = PiState.fromJson(const <String, dynamic>{
        'model': null,
        'sessionId': 'pi-2',
      });

      expect(state.model, isNull);
      expect(state.sessionId, 'pi-2');
    });
  });

  group('PiModel.fromJson', () {
    test('defaults input and cost when the bridge omits them', () {
      final model = PiModel.fromJson(const <String, dynamic>{'id': 'm-1'});

      expect(model.id, 'm-1');
      expect(model.name, '');
      expect(model.provider, '');
      expect(model.input, ['text']);
      expect(model.supportsImages, isFalse);
      expect(model.cost.input, 0);
      expect(model.cost.cacheWrite, 0);
      expect(model.authenticated, isTrue);
      expect(model.isOAuth, isFalse);
    });

    test('reads image support and oauth flags from the payload', () {
      final model = PiModel.fromJson(const <String, dynamic>{
        'id': 'm-2',
        'input': ['text', 'image'],
        'authenticated': false,
        'isOAuth': true,
      });

      expect(model.supportsImages, isTrue);
      expect(model.authenticated, isFalse);
      expect(model.isOAuth, isTrue);
    });
  });

  group('PiSessionInfo.fromJson', () {
    test('parses a session summary payload with stats', () {
      final info = PiSessionInfo.fromJson(<String, dynamic>{
        'path': '/tmp/pi/s.jsonl',
        'id': 'pi-1',
        'cwd': '/tmp/pi',
        'name': 'Project work',
        'parentSessionPath': '/tmp/pi/parent.jsonl',
        'created': 1700000000000,
        'modified': 1700000005000,
        'messageCount': 42,
        'firstMessage': 'hello',
        'summary': {'additions': 10, 'deletions': 2, 'files': 3},
        'subagentToolCount': 4,
      });

      expect(info.id, 'pi-1');
      expect(info.cwd, '/tmp/pi');
      expect(info.name, 'Project work');
      expect(info.parentSessionPath, '/tmp/pi/parent.jsonl');
      expect(info.created, DateTime.fromMillisecondsSinceEpoch(1700000000000));
      expect(info.modified, DateTime.fromMillisecondsSinceEpoch(1700000005000));
      expect(info.messageCount, 42);
      expect(info.firstMessage, 'hello');
      expect(info.summary?.additions, 10);
      expect(info.summary?.files, 3);
      expect(info.subagentToolCount, 4);
    });

    test('parses a session without optional fields', () {
      final info = PiSessionInfo.fromJson(const <String, dynamic>{
        'path': '/tmp/pi/s.jsonl',
        'id': 'pi-2',
        'cwd': '/tmp/pi',
      });

      expect(info.id, 'pi-2');
      expect(info.name, isNull);
      expect(info.parentSessionPath, isNull);
      expect(info.summary, isNull);
      expect(info.subagentToolCount, isNull);
      expect(info.created, DateTime.fromMillisecondsSinceEpoch(0));
      expect(info.messageCount, 0);
      expect(info.firstMessage, '');
    });
  });

  group('PiSessionStats.fromJson', () {
    test('parses token and context usage', () {
      final stats = PiSessionStats.fromJson(<String, dynamic>{
        'sessionFile': '/tmp/pi/s.jsonl',
        'sessionId': 'pi-1',
        'userMessages': 3,
        'assistantMessages': 4,
        'toolCalls': 5,
        'toolResults': 5,
        'totalMessages': 12,
        'tokens': <String, dynamic>{
          'input': 100,
          'output': 200,
          'cacheRead': 5,
          'cacheWrite': 1,
          'total': 306,
        },
        'cost': 0.42,
        'contextUsage': <String, dynamic>{
          'tokens': 1234,
          'contextWindow': 200000,
          'percent': 0.6,
        },
      });

      expect(stats.sessionFile, '/tmp/pi/s.jsonl');
      expect(stats.userMessages, 3);
      expect(stats.tokens.total, 306);
      expect(stats.cost, 0.42);
      expect(stats.contextUsage?.tokens, 1234);
      expect(stats.contextUsage?.contextWindow, 200000);
      expect(stats.contextUsage?.percent, 0.6);
    });

    test('defaults missing stats', () {
      final stats = PiSessionStats.fromJson(const <String, dynamic>{});

      expect(stats.sessionId, '');
      expect(stats.tokens.input, 0);
      expect(stats.cost, 0);
      expect(stats.contextUsage, isNull);
    });
  });

  group('PiStreamMessage.fromJson', () {
    test('maps assistant text and thinking deltas by wire type', () {
      final text = PiStreamMessage.fromJson(const <String, dynamic>{
        'type': 'text-delta',
        'content': 'Hi',
      });
      expect(text.textDelta, 'Hi');
      expect(text.thinkingDelta, isNull);

      final thinking = PiStreamMessage.fromJson(const <String, dynamic>{
        'type': 'thinking-delta',
        'content': 'plan',
      });
      expect(thinking.thinkingDelta, 'plan');
      expect(thinking.textDelta, isNull);
    });

    test('maps an extension UI request and keeps the payload intact', () {
      final message = PiStreamMessage.fromJson(const <String, dynamic>{
        'type': 'extension-ui-request',
        'id': 'req-7',
        'method': 'select',
        'options': ['a', 'b'],
      });

      expect(message.extensionUiRequestId, 'req-7');
      expect(message.extensionUiMethod, 'select');
      expect(message.raw['options'], ['a', 'b']);
    });

    test('maps bash output and error stream messages', () {
      final bash = PiStreamMessage.fromJson(const <String, dynamic>{
        'type': 'bash-output',
        'content': 'chunk',
      });
      expect(bash.isBashOutput, isTrue);
      expect(bash.bashOutputContent, 'chunk');

      final error = PiStreamMessage.fromJson(const <String, dynamic>{
        'type': 'error',
        'message': 'boom',
      });
      expect(error.isError, isTrue);
      expect(error.errorMessage, 'boom');
    });

    test('defaults an unknown stream type without throwing', () {
      final message = PiStreamMessage.fromJson(const <String, dynamic>{
        'method': 'x',
      });

      expect(message.type, 'unknown');
      expect(message.textDelta, isNull);
      expect(message.extensionUiMethod, isNull);
      expect(message.bashOutputContent, isNull);
      expect(message.raw['method'], 'x');
    });
  });

  group('PiQueueState.fromJson', () {
    test('parses steering and follow-up queues', () {
      final queue = PiQueueState.fromJson(const <String, dynamic>{
        'steering': ['steer-1'],
        'followUp': ['follow-1', 'follow-2'],
      });

      expect(queue.steering, ['steer-1']);
      expect(queue.followUp, ['follow-1', 'follow-2']);
      expect(queue.total, 3);
      expect(queue.isNotEmpty, isTrue);
    });

    test('treats a missing queue payload as empty', () {
      final queue = PiQueueState.fromJson(const <String, dynamic>{});

      expect(queue.steering, isEmpty);
      expect(queue.followUp, isEmpty);
      expect(queue.total, 0);
      expect(queue.isEmpty, isTrue);
    });
  });

  group('PiForkMessage.fromJson', () {
    test('defaults a fork message without text', () {
      final message = PiForkMessage.fromJson(const <String, dynamic>{
        'entryId': 'e1',
      });

      expect(message.entryId, 'e1');
      expect(message.text, '');
    });
  });
}
