enum AgentType {
  opencode,
  claudeCode,
  codex,
  pi,
  piDurable;

  String get displayName {
    switch (this) {
      case AgentType.opencode:
        return 'OpenCode';
      case AgentType.claudeCode:
        return 'Claude Code';
      case AgentType.codex:
        return 'Codex';
      case AgentType.pi:
        return 'Pi';
      case AgentType.piDurable:
        return 'Pi Durable';
    }
  }

  String get description {
    switch (this) {
      case AgentType.opencode:
        return 'Open source AI coding agent';
      case AgentType.claudeCode:
        return 'Anthropic Claude Code SDK';
      case AgentType.codex:
        return 'OpenAI Codex app-server';
      case AgentType.pi:
        return 'Multi-provider coding agent';
      case AgentType.piDurable:
        return 'Pi sessions that survive bridge restarts';
    }
  }

  String get wireValue {
    switch (this) {
      case AgentType.opencode:
        return 'opencode';
      case AgentType.claudeCode:
        return 'claude-code';
      case AgentType.codex:
        return 'codex';
      case AgentType.pi:
        return 'pi';
      case AgentType.piDurable:
        return 'pi-durable';
    }
  }

  static AgentType fromWireValue(String value) {
    switch (value) {
      case 'claude-code':
        return AgentType.claudeCode;
      case 'codex':
        return AgentType.codex;
      case 'pi':
        return AgentType.pi;
      case 'pi-durable':
        return AgentType.piDurable;
      default:
        return AgentType.opencode;
    }
  }
}

/// Backends hidden behind the Settings → AI Backend "Experimental" toggle.
const experimentalAgentTypes = <AgentType>{AgentType.piDurable};

bool isExperimentalAgent(AgentType type) =>
    experimentalAgentTypes.contains(type);

/// The backends pickers and session lists may show. Experimental backends stay
/// invisible until enabled.
List<AgentType> visibleAgentTypes({required bool piDurableEnabled}) {
  return AgentType.values
      .where(
        (type) => piDurableEnabled || !experimentalAgentTypes.contains(type),
      )
      .toList();
}

/// The selection to fall back to when the current backend is experimental and
/// its flag is off, so switching the flag off cannot strand the app on a
/// backend the rest of the UI hides.
AgentType resolveVisibleAgent(
  AgentType selected, {
  required bool piDurableEnabled,
}) {
  if (!experimentalAgentTypes.contains(selected)) return selected;
  return piDurableEnabled ? selected : AgentType.opencode;
}

class AgentStatusInfo {
  final bool available;
  final String? authMethod;
  final String? version;

  const AgentStatusInfo({
    required this.available,
    this.authMethod,
    this.version,
  });

  factory AgentStatusInfo.fromJson(Map<String, dynamic> json) {
    return AgentStatusInfo(
      available: json['available'] as bool? ?? false,
      authMethod: json['authMethod'] as String?,
      version: json['version'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'available': available,
      if (authMethod != null) 'authMethod': authMethod,
      if (version != null) 'version': version,
    };
  }
}

class AgentsStatus {
  final AgentStatusInfo opencode;
  final AgentStatusInfo claudeCode;
  final AgentStatusInfo codex;
  final AgentStatusInfo pi;
  final AgentStatusInfo piDurable;

  const AgentsStatus({
    required this.opencode,
    required this.claudeCode,
    required this.codex,
    required this.pi,
    required this.piDurable,
  });

  factory AgentsStatus.fromJson(Map<String, dynamic> json) {
    return AgentsStatus(
      opencode: AgentStatusInfo.fromJson(
        json['opencode'] as Map<String, dynamic>? ?? const {},
      ),
      claudeCode: AgentStatusInfo.fromJson(
        json['claude-code'] as Map<String, dynamic>? ?? const {},
      ),
      codex: AgentStatusInfo.fromJson(
        json['codex'] as Map<String, dynamic>? ?? const {},
      ),
      pi: AgentStatusInfo.fromJson(
        json['pi'] as Map<String, dynamic>? ?? const {},
      ),
      piDurable: AgentStatusInfo.fromJson(
        json['pi-durable'] as Map<String, dynamic>? ?? const {},
      ),
    );
  }

  AgentStatusInfo forType(AgentType type) {
    switch (type) {
      case AgentType.opencode:
        return opencode;
      case AgentType.claudeCode:
        return claudeCode;
      case AgentType.codex:
        return codex;
      case AgentType.pi:
        return pi;
      case AgentType.piDurable:
        return piDurable;
    }
  }
}
