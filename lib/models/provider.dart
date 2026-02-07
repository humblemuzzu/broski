// Feature 16: Full Provider Management
// Models for AI provider information, auth methods, and model details

/// Represents all available provider information
class ProviderInfo {
  final List<ProviderDetails> all;
  final Map<String, String> defaults;
  final List<String> connected;

  const ProviderInfo({
    required this.all,
    required this.defaults,
    required this.connected,
  });

  factory ProviderInfo.fromJson(Map<String, dynamic> json) {
    final allProviders = (json['all'] as List<dynamic>? ?? [])
        .map((p) => ProviderDetails.fromJson(p as Map<String, dynamic>))
        .toList();

    final defaultsMap = <String, String>{};
    final defaultsJson = json['default'] as Map<String, dynamic>? ?? {};
    for (final entry in defaultsJson.entries) {
      defaultsMap[entry.key] = entry.value.toString();
    }

    final connectedList = (json['connected'] as List<dynamic>? ?? [])
        .map((c) => c.toString())
        .toList();

    return ProviderInfo(
      all: allProviders,
      defaults: defaultsMap,
      connected: connectedList,
    );
  }

  bool isConnected(String providerId) => connected.contains(providerId);
}

/// Detailed information about a single provider
class ProviderDetails {
  final String id;
  final String name;
  final Map<String, ModelInfo> models;

  const ProviderDetails({
    required this.id,
    required this.name,
    required this.models,
  });

  factory ProviderDetails.fromJson(Map<String, dynamic> json) {
    final modelsJson = json['models'] as Map<String, dynamic>? ?? {};
    final modelsMap = <String, ModelInfo>{};
    for (final entry in modelsJson.entries) {
      modelsMap[entry.key] = ModelInfo.fromJson(
        entry.key,
        entry.value as Map<String, dynamic>,
      );
    }

    return ProviderDetails(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? json['id'] as String? ?? '',
      models: modelsMap,
    );
  }

  int get modelCount => models.length;
}

/// Information about a specific AI model
class ModelInfo {
  final String id;
  final String name;
  final int? contextWindow;
  final double? inputPricing;
  final double? outputPricing;

  const ModelInfo({
    required this.id,
    required this.name,
    this.contextWindow,
    this.inputPricing,
    this.outputPricing,
  });

  factory ModelInfo.fromJson(String id, Map<String, dynamic> json) {
    final pricing = json['pricing'] as Map<String, dynamic>?;
    return ModelInfo(
      id: id,
      name: json['name'] as String? ?? id,
      contextWindow: json['contextWindow'] as int?,
      inputPricing: pricing?['input'] as double?,
      outputPricing: pricing?['output'] as double?,
    );
  }

  String get displayContextWindow {
    if (contextWindow == null) return 'Unknown';
    if (contextWindow! >= 1000000) {
      return '${(contextWindow! / 1000000).toStringAsFixed(1)}M';
    }
    if (contextWindow! >= 1000) {
      return '${(contextWindow! / 1000).toStringAsFixed(0)}K';
    }
    return contextWindow.toString();
  }
}

/// Authentication method for a provider
enum ProviderAuthType { api, oauth }

class ProviderAuthMethod {
  final ProviderAuthType type;
  final String label;
  final String? description;
  final String? url;

  const ProviderAuthMethod({
    required this.type,
    required this.label,
    this.description,
    this.url,
  });

  factory ProviderAuthMethod.fromJson(Map<String, dynamic> json) {
    return ProviderAuthMethod(
      type: json['type'] == 'oauth'
          ? ProviderAuthType.oauth
          : ProviderAuthType.api,
      label:
          (json['label'] as String?) ?? (json['name'] as String?) ?? 'Unknown',
      description: json['description'] as String?,
      url: json['url'] as String?,
    );
  }

  // Backward-compatible alias
  String get name => label;

  bool get isApiKey => type == ProviderAuthType.api;
  bool get isOAuth => type == ProviderAuthType.oauth;
}

class ProviderAuthAuthorization {
  final String url;
  final String method;
  final String instructions;

  const ProviderAuthAuthorization({
    required this.url,
    required this.method,
    required this.instructions,
  });

  factory ProviderAuthAuthorization.fromJson(Map<String, dynamic> json) {
    return ProviderAuthAuthorization(
      url: json['url'] as String? ?? '',
      method: json['method'] as String? ?? 'auto',
      instructions: json['instructions'] as String? ?? '',
    );
  }

  bool get requiresCode => method == 'code';
}
