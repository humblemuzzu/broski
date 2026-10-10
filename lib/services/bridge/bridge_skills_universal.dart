part of '../bridge_service.dart';

/// Universal skills API — dispatches to agent-specific implementations.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceSkillsUniversal on BridgeService {
  Future<List<Skill>> listSkills({
    required AgentType backend,
    String? cwd,
    bool forceReload = false,
  }) async {
    switch (backend) {
      case AgentType.opencode:
        return ocListSkills(cwd: cwd);
      case AgentType.claudeCode:
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
      case AgentType.codex:
        final raw = await cxListSkills(cwd: cwd, forceReload: forceReload);
        return raw.map((m) {
          final scope = m['scope'] as String?;
          final source = switch (scope) {
            'Repo' => SkillSource.project,
            'User' => SkillSource.user,
            'Admin' => SkillSource.admin,
            _ => SkillSource.system,
          };
          return Skill(
            backend: AgentType.codex,
            name: m['name'] as String? ?? '',
            description: m['description'] as String?,
            source: source,
            path: m['path'] as String? ?? '',
            extra: {
              'scope': scope,
              if (m['shortDescription'] != null)
                'short_description': m['shortDescription'],
            },
          );
        }).toList();
      case AgentType.pi:
        final requestId = _generateRequestId();
        _socket.send({
          'type': 'pi_list_commands',
          'requestId': requestId,
          if (cwd != null) 'projectPath': cwd,
        });
        final response = await _waitFor(
          'pi_commands',
          requestId: requestId,
          timeoutSeconds: 15,
        );
        final data = response['data'] as List<dynamic>? ?? const [];
        return data.whereType<Map<String, dynamic>>().map((cmd) {
          final source = cmd['source'] as String? ?? 'extension';
          final skillSource = switch (source) {
            'skill' => SkillSource.user,
            'prompt' => SkillSource.project,
            _ => SkillSource.system,
          };
          return Skill(
            backend: AgentType.pi,
            name: cmd['name'] as String? ?? '',
            description: cmd['description'] as String?,
            source: skillSource,
            path: cmd['path'] as String? ?? '',
            extra: {'piSource': source},
          );
        }).toList();
      case AgentType.piDurable:
        return skillsFromUnifiedPayload(
          await unifiedListSkills(backend: AgentType.piDurable, cwd: cwd),
          backend: AgentType.piDurable,
        );
    }
  }

  Future<Skill?> getSkill({required Skill skill, String? cwd}) async {
    switch (skill.backend) {
      case AgentType.opencode:
        return ocGetSkill(name: skill.name, source: skill.source, cwd: cwd);
      case AgentType.claudeCode:
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
      case AgentType.codex:
        return cxGetSkill(name: skill.name, source: skill.source, cwd: cwd);
      case AgentType.pi:
        return null;
      case AgentType.piDurable:
        return null;
    }
  }

  Future<bool> saveSkill({
    required AgentType backend,
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    switch (backend) {
      case AgentType.opencode:
        return ocSaveSkill(
          name: name,
          source: source,
          content: content,
          cwd: cwd,
        );
      case AgentType.claudeCode:
        return ccSaveSkill(
          name: name,
          source: source,
          content: content,
          cwd: cwd,
        );
      case AgentType.codex:
        return cxSaveSkill(
          name: name,
          source: source,
          content: content,
          cwd: cwd,
        );
      case AgentType.pi:
        return false;
      case AgentType.piDurable:
        return false;
    }
  }

  Future<bool> deleteSkill({
    required AgentType backend,
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    switch (backend) {
      case AgentType.opencode:
        return ocDeleteSkill(name: name, source: source, cwd: cwd);
      case AgentType.claudeCode:
        return ccDeleteSkill(name: name, source: source, cwd: cwd);
      case AgentType.codex:
        return cxDeleteSkill(name: name, source: source, cwd: cwd);
      case AgentType.pi:
        return false;
      case AgentType.piDurable:
        return false;
    }
  }
}
