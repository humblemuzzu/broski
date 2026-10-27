import 'package:broski/utils/ansi_escape.dart';
import 'package:flutter_test/flutter_test.dart';

String _repeat(String unit, int bytes) {
  final buffer = StringBuffer();
  while (buffer.length < bytes) {
    buffer.write(unit);
  }
  return buffer.toString();
}

void main() {
  group('stripAnsi', () {
    test('leaves text without escapes untouched', () {
      const text = 'plain text, no codes';
      expect(stripAnsi(text), same(text));
    });

    test('drops the colour codes a provider writes into its thinking', () {
      expect(
        stripAnsi(
          '\u001b[38;2;215;153;33mThinking:\u001b[39m '
          '\u001b[38;2;168;153;132mThe user is asking…',
        ),
        'Thinking: The user is asking…',
      );
    });

    test('drops CSI sequences of every shape', () {
      expect(stripAnsi('a\u001b[1;31;40mred\u001b[0mb'), 'aredb');
      expect(stripAnsi('a\u001b[2Kb'), 'ab');
      expect(stripAnsi('a\u001b[?25lb'), 'ab');
      expect(stripAnsi('a\u001b[ qb'), 'ab');
      expect(stripAnsi('a\u001b[38:2::1:2:3mb'), 'ab');
    });

    test('drops OSC sequences terminated by BEL or by ESC \\', () {
      expect(stripAnsi('a\u001b]0;title\u0007b'), 'ab');
      expect(stripAnsi('a\u001b]8;;https://example.com\u001b\\link'), 'alink');
    });

    test('drops a lone ESC and the character it introduces', () {
      expect(stripAnsi('a\u001bMb'), 'ab');
      expect(stripAnsi('a\u001bcb'), 'ab');
    });

    test('keeps text around and between sequences', () {
      expect(
        stripAnsi('\u001b[31mone\u001b[0m two \u001b[32mthree\u001b[0m'),
        'one two three',
      );
    });

    test('leaves multi-byte text alone', () {
      expect(stripAnsi('\u001b[31mハロー 🎉 héllo\u001b[0m'), 'ハロー 🎉 héllo');
      expect(stripAnsi('naïve — 漢字'), 'naïve — 漢字');
    });

    test('a truncated sequence at the end of the text is dropped', () {
      expect(stripAnsi('done\u001b[38;2;1'), 'done');
      expect(stripAnsi('done\u001b'), 'done');
      expect(stripAnsi('done\u001b]0;title'), 'done');
    });

    test(
      'does not keep the U+241B picture of an escape, which no session holds',
      () {
        expect(stripAnsi('a␛[31mb'), 'a␛[31mb');
      },
    );

    test('is linear over a megabyte of coloured text', () {
      const sequence = '\u001b[38;2;215;153;33mthinking step\u001b[39m ';
      final text = _repeat(sequence, 1024 * 1024);
      final clock = Stopwatch()..start();
      final stripped = stripAnsi(text);
      clock.stop();

      expect(stripped.contains('\u001b'), isFalse);
      expect(
        stripped.length,
        'thinking step '.length * (text.length ~/ sequence.length),
      );
      expect(
        clock.elapsedMilliseconds,
        lessThan(500),
        reason: 'one megabyte of escapes took ${clock.elapsedMilliseconds} ms',
      );
    });
  });
}
