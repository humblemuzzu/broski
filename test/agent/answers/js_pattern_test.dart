import 'package:broski/agent/answers/js_pattern.dart';
import 'package:broski/agent/answers/js_pattern_syntax.dart';
import 'package:broski/agent/answers/js_search.dart';
import 'package:broski/agent/answers/js_unicode_reading.dart';
import 'package:flutter_test/flutter_test.dart';

/// Where Dart 3.10's regular expression engine and JavaScriptCore (Bun) part
/// ways, and what the app does about each (app-core README §8). What the app
/// judges is held to Bun by `tool/format_differential.dart`; these hold the
/// parts of it that a fixture of agreeing answers cannot show.
void main() {
  group('the u reading', () {
    String rewritten(String pattern, {bool nul = false}) =>
        unicodeReading(pattern, textHasNul: nul).pattern;

    test(
      'drops the backslash before a non-ASCII character of the first plane',
      () {
        expect(rewritten(r'\é[\Ā]'), 'é[Ā]');
      },
    );

    test('keeps an ASCII escape and an escaped backslash', () {
      expect(rewritten(r'\d\\é\.'), r'\d\\é\.');
    });

    test('leaves an astral escape and a lone surrogate escape as they are', () {
      expect(rewritten('\\\u{1f600}'), '\\\u{1f600}');
      expect(rewritten('[\\\ud83d]'), '[\\\ud83d]');
    });

    test('rewrites a negated class only when the text holds U+0000', () {
      expect(rewritten('[^a]'), '[^a]');
      expect(rewritten('[^a]+', nul: true), r'(?:(?![a])[\s\S])+');
      expect(rewritten('[^]', nul: true), r'[\s\S]');
      expect(rewritten('[a]', nul: true), '[a]');
    });

    test(
      'reads a class with escapes, brackets and a closing bracket escaped',
      () {
        expect(rewritten(r'[^\]a[]x', nul: true), r'(?:(?![\]a[])[\s\S])x');
        expect(rewritten(r'[\é^]', nul: true), '[é^]');
      },
    );

    test('notes a property escape, not an escaped backslash before p{', () {
      expect(
        unicodeReading(r'\p{L}', textHasNul: false).usesProperties,
        isTrue,
      );
      expect(
        unicodeReading(r'\P{L}', textHasNul: false).usesProperties,
        isTrue,
      );
      expect(
        unicodeReading(r'[\p{L}]', textHasNul: false).usesProperties,
        isTrue,
      );
      expect(
        unicodeReading(r'\\p{L}', textHasNul: false).usesProperties,
        isFalse,
      );
    });

    test('keeps an unclosed class and a trailing backslash as they are', () {
      expect(rewritten('[^a', nul: true), '[^a');
      expect(rewritten('a\\'), 'a\\');
    });
  });

  group('the search', () {
    bool searches(String pattern, String text) => searchesLikeEcmaScript(
      RegExp(pattern, unicode: true),
      text,
      unicode: true,
    );

    test(r'does not start a match between the halves of a pair: \B', () {
      expect(searches(r'\B', 'a\u{1f600}A'), isFalse);
      expect(RegExp(r'\B', unicode: true).hasMatch('a\u{1f600}A'), isTrue);
    });

    test('finds the match at a later code point after a bogus start', () {
      expect(searches('(?<!a)', 'a\u{1f600}'), isTrue);
      expect(searches(r'\B', '\u{1f600}\u{1f600}'), isTrue);
      expect(searches(r'\B', 'a\u{1f600}!'), isTrue);
    });

    test('takes the first match when it is a real one', () {
      expect(searches('a', 'xa'), isTrue);
      expect(searches('z', 'xa'), isFalse);
    });

    test('a plain reading starts anywhere, as the engine does', () {
      expect(
        searchesLikeEcmaScript(RegExp(r'\B'), 'a\u{1f600}A', unicode: false),
        isTrue,
      );
    });
  });

  group('patternProblem', () {
    test('judges a property escape for ASCII text', () {
      expect(patternProblem(r'^[^\P{L}]$', '1'), 'does not match the pattern');
      expect(patternProblem(r'^[^\P{L}]$', 'a'), isNull);
    });

    test('passes a text beyond ASCII that the bridge may see as a letter '
        'Dart does not know', () {
      expect(RegExp(r'^[^\P{L}]$', unicode: true).hasMatch('\u088f'), isFalse);
      expect(patternProblem(r'^[^\P{L}]$', '\u088f'), isNull);
      expect(patternProblem(r'^(?!\P{L})', '\u088f'), isNull);
    });

    test('still finds the plain reading missing a property pattern', () {
      expect(patternProblem(r'^\p{L}$', 'a'), 'does not match the pattern');
      expect(
        patternProblem(r'^\p{L}$', '\u088f'),
        'does not match the pattern',
      );
    });

    test('an escaped astral character is left to the bridge', () {
      expect(patternProblem('\\\u{1f600}', '\u{1f600}'), isNull);
      expect(patternProblem('[\\\u{1f600}]', '\u{1f600}'), isNull);
    });

    test('a negated class and U+0000 beside a character above U+00FF', () {
      expect(patternProblem('^[^a]+\$', '\u0100\u0000'), isNull);
      expect(patternProblem('[^a]', '\u0000\u0100'), isNull);
      expect(
        patternProblem('^[^\\x00]\$', '\u0000'),
        'does not match the pattern',
      );
    });

    test(
      'an escaped non-ASCII character of the first plane matches itself',
      () {
        expect(patternProblem(r'^\é$', 'é'), isNull);
        expect(patternProblem(r'^\é$', 'e'), 'does not match the pattern');
      },
    );

    test('a pattern that does not compile fails every answer', () {
      expect(
        patternProblem('(', 'x'),
        "the field's pattern does not compile, so no answer can pass it",
      );
    });
  });

  group('a group holding one lookaround', () {
    test('is repeatable, which Dart refuses', () {
      const pattern = '(?:(?<!a))*';
      expect(() => RegExp(pattern), throwsFormatException);
      final older = withoutNewerSyntax('^(?:(?<!a))*x\$');
      expect(older, isNotNull);
      expect(older!.sameMatches, isTrue);
      expect(RegExp(older.pattern).hasMatch('x'), isTrue);
      expect(RegExp(older.pattern).hasMatch('ax'), isFalse);
    });

    test(
      'is closed by the alternative only when the lookaround is all of it',
      () {
        expect(withoutNewerSyntax('(?:(?<!a)b)*'), isNull);
        expect(
          withoutNewerSyntax(r'(?:(?=a))+(?:\)(?=b))*')?.pattern,
          '(?:(?=a)|(?!))+(?:\\)(?=b))*',
        );
      },
    );

    test('a pattern with it matches as the bridge says', () {
      expect(patternProblem('^(?:(?<!a))*x\$', 'x'), isNull);
      expect(patternProblem('^(?:(?=a))+a\$', 'a'), isNull);
      expect(
        patternProblem('^(?:(?=a))+a\$', 'b'),
        'does not match the pattern',
      );
    });
  });
}
