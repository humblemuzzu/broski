enum AgentType {
  opencode,
  claudeCode,
  codex,
  pi;

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
      default:
        return AgentType.opencode;
    }
  }
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

  const AgentsStatus({
    required this.opencode,
    required this.claudeCode,
    required this.codex,
    required this.pi,
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
    }
  }
}
