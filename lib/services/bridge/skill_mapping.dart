import 'package:broski/models/agent_type.dart';
import 'package:broski/models/skill.dart';

/// Maps `unified_skills` rows (bridge `UnifiedSkillSummary`) onto app skills.
///
/// Pure so the mapping can be asserted without a bridge.
List<Skill> skillsFromUnifiedPayload(
  List<Map<String, dynamic>> payload, {
  required AgentType backend,
}) {
  final skills = <Skill>[];
  for (final row in payload) {
    final name = (row['name'] as String?)?.trim() ?? '';
    if (name.isEmpty) continue;
    skills.add(
      Skill(
        backend: backend,
        name: name,
        description: row['description'] as String?,
        source: SkillSource.fromWire(row['source'] as String?),
        path: row['path'] as String? ?? '',
        extra: {if (row['autoInvoke'] is bool) 'autoInvoke': row['autoInvoke']},
      ),
    );
  }
  return skills;
}
