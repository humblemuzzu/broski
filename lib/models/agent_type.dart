enum AgentType {
  claudeCode;

  String get displayName => 'Claude Code';

  String get description => 'Anthropic Claude Code SDK';

  String get wireValue => 'claude-code';

  static AgentType fromWireValue(String value) => AgentType.claudeCode;
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
  final AgentStatusInfo claudeCode;

  const AgentsStatus({required this.claudeCode});

  factory AgentsStatus.fromJson(Map<String, dynamic> json) {
    return AgentsStatus(
      claudeCode: AgentStatusInfo.fromJson(
        json['claude-code'] as Map<String, dynamic>? ?? const {},
      ),
    );
  }

  AgentStatusInfo forType(AgentType type) => claudeCode;
}
