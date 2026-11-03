import 'package:broski/screens/agent/composer/composer_rules.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('withReturnedInput follows the terminal composer after Esc', () {
    test('the returned messages come first, a blank line between parts', () {
      expect(withReturnedInput(['a', 'b'], 'typed'), 'a\n\nb\n\ntyped');
    });

    test('an empty or blank part is left out', () {
      expect(withReturnedInput(['a'], ''), 'a');
      expect(withReturnedInput(['a'], '  \n '), 'a');
      expect(withReturnedInput([], 'typed'), 'typed');
      expect(withReturnedInput(['  '], 'typed'), 'typed');
    });

    test('the typed text keeps its own whitespace', () {
      expect(withReturnedInput(['a'], '  indented\n'), 'a\n\n  indented\n');
    });
  });
}
