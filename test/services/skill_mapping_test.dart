import 'package:broski/models/agent_type.dart';
import 'package:broski/models/skill.dart';
import 'package:broski/services/bridge/skill_mapping.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('skillsFromUnifiedPayload', () {
    test('maps the pi-durable unified skill row shape', () {
      final skills = skillsFromUnifiedPayload([
        {
          'name': 'brainstorm',
          'description': 'Explore options',
          'source': 'project',
          'path': '/repo/.pi/skills/brainstorm/SKILL.md',
          'autoInvoke': true,
        },
        {
          'name': 'debug',
          'description': 'Root-cause a bug',
          'source': 'user',
          'path': '/Users/me/.pi/agent/skills/debug/SKILL.md',
          'autoInvoke': false,
        },
      ], backend: AgentType.piDurable);

      expect(skills.map((skill) => skill.name), ['brainstorm', 'debug']);
      expect(
        skills.every((skill) => skill.backend == AgentType.piDurable),
        isTrue,
      );
      expect(skills.first.source, SkillSource.project);
      expect(skills.first.description, 'Explore options');
      expect(skills.first.path, '/repo/.pi/skills/brainstorm/SKILL.md');
      expect(skills.first.extra?['autoInvoke'], isTrue);
      expect(skills.last.source, SkillSource.user);
      expect(skills.last.extra?['autoInvoke'], isFalse);
    });

    test('an absent scope falls back to the system source', () {
      final skills = skillsFromUnifiedPayload([
        {'name': 'plain', 'path': '/skills/plain/SKILL.md'},
      ], backend: AgentType.pi);

      expect(skills.single.source, SkillSource.system);
      expect(skills.single.backend, AgentType.pi);
      expect(skills.single.path, '/skills/plain/SKILL.md');
      expect(skills.single.extra, isEmpty);
    });

    test('skips rows without a usable name', () {
      final skills = skillsFromUnifiedPayload([
        {'description': 'no name'},
        {'name': '   '},
        {'name': ' keep '},
      ], backend: AgentType.piDurable);

      expect(skills.map((skill) => skill.name), ['keep']);
    });

    test('an empty payload maps to no skills', () {
      expect(
        skillsFromUnifiedPayload(const [], backend: AgentType.piDurable),
        isEmpty,
      );
    });
  });
}
