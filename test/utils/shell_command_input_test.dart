import 'package:broski/utils/shell_command_input.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reads the command from either parameter name', () {
    expect(shellCommandOf({'command': 'ls'}), 'ls');
    expect(shellCommandOf({'cmd': 'git status', 'timeout': 15}), 'git status');
  });

  test('prefers command when a tool sends both', () {
    expect(shellCommandOf({'command': 'a', 'cmd': 'b'}), 'a');
  });

  test('is empty when the tool carries none', () {
    expect(shellCommandOf({}), '');
    expect(shellCommandOf({'cmd': 3}), '');
  });
}
