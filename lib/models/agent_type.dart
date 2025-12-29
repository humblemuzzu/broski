enum AgentType {
  opencode,
  claudeCode;

  String get displayName {
    switch (this) {
      case AgentType.opencode:
        return 'OpenCode';
      case AgentType.claudeCode:
        return 'Claude Code';
    }
  }

  String get description {
    switch (this) {
      case AgentType.opencode:
        return 'Open source AI coding agent';
      case AgentType.claudeCode:
        return 'Anthropic Claude Code SDK';
    }
  }

  String get wireValue {
    switch (this) {
      case AgentType.opencode:
        return 'opencode';
      case AgentType.claudeCode:
        return 'claude-code';
    }
  }

  static AgentType fromWireValue(String value) {
    switch (value) {
      case 'claude-code':
        return AgentType.claudeCode;
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

  const AgentsStatus({required this.opencode, required this.claudeCode});

  factory AgentsStatus.fromJson(Map<String, dynamic> json) {
    return AgentsStatus(
      opencode: AgentStatusInfo.fromJson(
        json['opencode'] as Map<String, dynamic>? ?? const {},
      ),
      claudeCode: AgentStatusInfo.fromJson(
        json['claude-code'] as Map<String, dynamic>? ?? const {},
      ),
    );
  }

  AgentStatusInfo forType(AgentType type) {
    switch (type) {
      case AgentType.opencode:
        return opencode;
      case AgentType.claudeCode:
        return claudeCode;
    }
  }
}
