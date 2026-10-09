import 'package:broski/models/pi_bang_command.dart';
import 'package:flutter_test/flutter_test.dart';

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
}
