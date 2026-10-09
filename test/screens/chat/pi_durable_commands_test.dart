import 'package:broski/models/command.dart';
import 'package:broski/screens/chat/pi_durable_commands.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('pi-durable slash command source', () {
    test('maps bridge skills to custom skill commands', () {
      final commands = piDurableCommandsFromSkills([
        {
          'name': 'brainstorm',
          'description': 'Explore options',
          'source': 'project',
        },
        {'name': 'debug', 'description': 'Root-cause a bug', 'source': 'user'},
      ]);

      expect(commands.map((command) => command.name), ['brainstorm', 'debug']);
      expect(
        commands.every((command) => command.source == CommandSource.skill),
        isTrue,
      );
      expect(commands.every((command) => command.builtin), isFalse);
      expect(commands.first.description, 'Explore options');
    });

    test('skips nameless and blank skills', () {
      final commands = piDurableCommandsFromSkills([
        {'description': 'no name'},
        {'name': '  ', 'description': 'blank'},
        {'name': 'keep'},
      ]);

      expect(commands.map((command) => command.name), ['keep']);
      expect(commands.single.description, isNull);
    });

    test('an empty skill list carries no OpenCode built-ins', () {
      expect(piDurableCommandsFromSkills(const []), isEmpty);
    });
  });
}
