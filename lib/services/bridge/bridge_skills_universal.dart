part of '../bridge_service.dart';

/// The skills API the skills screen uses, over Claude Code's skill files.
extension BridgeServiceSkillsUniversal on BridgeService {
  Future<List<Skill>> listSkills({
    required AgentType backend,
    String? cwd,
  }) async {
    final skills = await ccListSkills(cwd: cwd);
    return skills
        .map(
          (s) => Skill(
            backend: AgentType.claudeCode,
            name: s.name,
            description: s.description,
            source: SkillSource.fromWire(s.source),
            path: s.path ?? '',
            extra: {
              'autoInvoke': s.autoInvoke,
              if (s.tags != null) 'tags': s.tags,
              if (s.agent != null) 'agent': s.agent,
              if (s.context != null) 'context': s.context,
            },
          ),
        )
        .toList();
  }

  Future<Skill?> getSkill({required Skill skill, String? cwd}) async {
    final tags = (skill.extra?['tags'] as List?)?.cast<String>();
    final autoInvoke = skill.extra?['autoInvoke'] == true;
    return ccGetSkill(
      skill: ClaudeCodeSkill(
        name: skill.name,
        description: skill.description,
        autoInvoke: autoInvoke,
        tags: tags,
        source: skill.source.wireValue,
        path: skill.path.isEmpty ? null : skill.path,
      ),
      cwd: cwd,
    );
  }

  Future<bool> saveSkill({
    required AgentType backend,
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    return ccSaveSkill(name: name, source: source, content: content, cwd: cwd);
  }

  Future<bool> deleteSkill({
    required AgentType backend,
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    return ccDeleteSkill(name: name, source: source, cwd: cwd);
  }
}
