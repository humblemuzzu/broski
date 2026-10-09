import 'package:broski/models/message.dart';
import 'package:broski/models/pi_bang_command.dart';
import 'package:broski/models/pi_bash_card.dart';
import 'package:broski/screens/chat/pi_bang_command.dart';
import 'package:flutter_test/flutter_test.dart';

ChatMessage bashCard(String sessionId, {required bool running}) {
  return ChatMessage(
    id: 'bash-$sessionId-$running',
    sessionId: sessionId,
    role: MessageRole.user,
    createdAt: DateTime(2026),
    text: 'ls',
    metadata: running
        ? piBashRunningMetadata(command: 'ls', excludeFromContext: false)
        : piBashFinishedMetadata(
            command: 'ls',
            excludeFromContext: false,
            output: 'ok',
            exitCode: 0,
          ),
  );
}

ChatMessage plainMessage(String sessionId) {
  return ChatMessage(
    id: 'msg-$sessionId',
    sessionId: sessionId,
    role: MessageRole.user,
    createdAt: DateTime(2026),
    text: 'explain this file',
  );
}

void main() {
  group('parsePiBangCommand', () {
    test('extracts a command that is included in context', () {
      final parsed = parsePiBangCommand('!ls -la');

      expect(parsed, isNotNull);
      expect(parsed!.command, 'ls -la');
      expect(parsed.excludeFromContext, isFalse);
    });

    test('marks a double-bang command as excluded from context', () {
      final parsed = parsePiBangCommand('!!git status');

      expect(parsed, isNotNull);
      expect(parsed!.command, 'git status');
      expect(parsed.excludeFromContext, isTrue);
    });

    test('trims surrounding whitespace from the command body', () {
      expect(parsePiBangCommand('!   echo hi   ')!.command, 'echo hi');
    });

    test('treats a third bang as part of the command', () {
      final parsed = parsePiBangCommand('!!! echo hi');

      expect(parsed!.excludeFromContext, isTrue);
      expect(parsed.command, '! echo hi');
    });

    test('returns null for bare or whitespace-only commands', () {
      expect(parsePiBangCommand('!'), isNull);
      expect(parsePiBangCommand('!   '), isNull);
      expect(parsePiBangCommand('!!'), isNull);
      expect(parsePiBangCommand('!!\t'), isNull);
    });

    test('returns null for a normal prompt', () {
      expect(parsePiBangCommand('explain this file'), isNull);
    });
  });

  group('hasRunningPiBashCommand', () {
    test('is false with no messages', () {
      expect(hasRunningPiBashCommand(const [], 'pi-1'), isFalse);
    });

    test('is true while a matching session card is running', () {
      final messages = [plainMessage('pi-1'), bashCard('pi-1', running: true)];

      expect(hasRunningPiBashCommand(messages, 'pi-1'), isTrue);
    });

    test('is false once the card finishes', () {
      final messages = [bashCard('pi-1', running: false)];

      expect(hasRunningPiBashCommand(messages, 'pi-1'), isFalse);
    });

    test('ignores a running card from a different session', () {
      final messages = [bashCard('pi-2', running: true)];

      expect(hasRunningPiBashCommand(messages, 'pi-1'), isFalse);
    });

    test('ignores non-bash messages', () {
      final messages = [plainMessage('pi-1'), plainMessage('pi-1')];

      expect(hasRunningPiBashCommand(messages, 'pi-1'), isFalse);
    });
  });
}
