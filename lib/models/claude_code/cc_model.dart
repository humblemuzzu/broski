class ClaudeCodeSupportedModel {
  final String value;
  final String displayName;
  final String description;
  final bool? supportsEffort;
  final List<String>? supportedEffortLevels;
  final bool? supportsAdaptiveThinking;
  final bool? supportsFastMode;

  const ClaudeCodeSupportedModel({
    required this.value,
    required this.displayName,
    required this.description,
    this.supportsEffort,
    this.supportedEffortLevels,
    this.supportsAdaptiveThinking,
    this.supportsFastMode,
  });

  factory ClaudeCodeSupportedModel.fromJson(Map<String, dynamic> json) {
    final value = json['value'] as String? ?? '';
    return ClaudeCodeSupportedModel(
      value: value,
      displayName: json['displayName'] as String? ?? value,
      description: json['description'] as String? ?? '',
      supportsEffort: json['supportsEffort'] as bool?,
      supportedEffortLevels: (json['supportedEffortLevels'] as List<dynamic>?)
          ?.map((e) => '$e')
          .toList(),
      supportsAdaptiveThinking: json['supportsAdaptiveThinking'] as bool?,
      supportsFastMode: json['supportsFastMode'] as bool?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'value': value,
      'displayName': displayName,
      'description': description,
      if (supportsEffort != null) 'supportsEffort': supportsEffort,
      if (supportedEffortLevels != null)
        'supportedEffortLevels': supportedEffortLevels,
      if (supportsAdaptiveThinking != null)
        'supportsAdaptiveThinking': supportsAdaptiveThinking,
      if (supportsFastMode != null) 'supportsFastMode': supportsFastMode,
    };
  }

  bool get supportsOneMillionContext {
    final normalized = value.toLowerCase();
    return normalized.contains('sonnet') ||
        normalized.contains('opus') ||
        normalized.contains('claude-4');
  }
}

class ClaudeCodeAccountInfo {
  final String? email;
  final String? organization;
  final String? subscriptionType;
  final String? tokenSource;
  final String? apiKeySource;

  /// Not in SDK AccountInfo type but present in raw response; used by bridge for env var injection.
  final String? accountUuid;
  final String? organizationUuid;

  const ClaudeCodeAccountInfo({
    this.email,
    this.organization,
    this.subscriptionType,
    this.tokenSource,
    this.apiKeySource,
    this.accountUuid,
    this.organizationUuid,
  });

  factory ClaudeCodeAccountInfo.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeAccountInfo(
      email: json['email'] as String?,
      organization: json['organization'] as String?,
      subscriptionType: json['subscriptionType'] as String?,
      tokenSource: json['tokenSource'] as String?,
      apiKeySource: json['apiKeySource'] as String?,
      accountUuid: json['accountUuid'] as String?,
      organizationUuid: json['organizationUuid'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (email != null) 'email': email,
      if (organization != null) 'organization': organization,
      if (subscriptionType != null) 'subscriptionType': subscriptionType,
      if (tokenSource != null) 'tokenSource': tokenSource,
      if (apiKeySource != null) 'apiKeySource': apiKeySource,
      if (accountUuid != null) 'accountUuid': accountUuid,
      if (organizationUuid != null) 'organizationUuid': organizationUuid,
    };
  }
}
