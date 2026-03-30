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

/// Information about a specific AI model (enriched from SDK ProviderList)
class ModelInfo {
  final String id;
  final String name;
  final String? family;
  final int? contextWindow;
  final int? outputLimit;
  final bool reasoning;
  final bool attachment;
  final bool toolCall;
  final ModelModalities? modalities;
  final String? status; // 'alpha' | 'beta' | 'deprecated' | 'active'
  final bool experimental;
  final double? inputPricing;
  final double? outputPricing;
  final double? cacheReadPricing;
  final double? cacheWritePricing;
  final Map<String, dynamic>? variants;

  const ModelInfo({
    required this.id,
    required this.name,
    this.family,
    this.contextWindow,
    this.outputLimit,
    this.reasoning = false,
    this.attachment = false,
    this.toolCall = false,
    this.modalities,
    this.status,
    this.experimental = false,
    this.inputPricing,
    this.outputPricing,
    this.cacheReadPricing,
    this.cacheWritePricing,
    this.variants,
  });

  factory ModelInfo.fromJson(String id, Map<String, dynamic> json) {
    final pricing = json['pricing'] as Map<String, dynamic>?;
    final mods = json['modalities'] as Map<String, dynamic>?;
    return ModelInfo(
      id: id,
      name: json['name'] as String? ?? id,
      family: json['family'] as String?,
      contextWindow: json['contextWindow'] as int?,
      outputLimit: json['outputLimit'] as int?,
      reasoning: json['reasoning'] as bool? ?? false,
      attachment: json['attachment'] as bool? ?? false,
      toolCall: json['toolCall'] as bool? ?? false,
      modalities: mods != null ? ModelModalities.fromJson(mods) : null,
      status: json['status'] as String?,
      experimental: json['experimental'] as bool? ?? false,
      inputPricing: (pricing?['input'] as num?)?.toDouble(),
      outputPricing: (pricing?['output'] as num?)?.toDouble(),
      cacheReadPricing: (pricing?['cacheRead'] as num?)?.toDouble(),
      cacheWritePricing: (pricing?['cacheWrite'] as num?)?.toDouble(),
      variants: json['variants'] as Map<String, dynamic>?,
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

  bool get supportsImages =>
      modalities?.input.contains('image') == true || attachment;
  bool get supportsPdf => modalities?.input.contains('pdf') == true;
  bool get supportsAudio => modalities?.input.contains('audio') == true;
  bool get isDeprecated => status == 'deprecated';
  bool get isBeta => status == 'beta';
  bool get isAlpha => status == 'alpha';
  bool get hasVariants => variants != null && variants!.isNotEmpty;
}

/// Input/output modalities for a model
class ModelModalities {
  final List<String> input;
  final List<String> output;

  const ModelModalities({this.input = const [], this.output = const []});

  factory ModelModalities.fromJson(Map<String, dynamic> json) {
    return ModelModalities(
      input:
          (json['input'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
      output:
          (json['output'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
    );
  }
}

/// Authentication method for a provider
enum ProviderAuthType { api, oauth }

class ProviderAuthMethod {
  final ProviderAuthType type;
  final String label;
  final String? description;
  final String? url;
  final List<AuthPrompt> prompts;

  const ProviderAuthMethod({
    required this.type,
    required this.label,
    this.description,
    this.url,
    this.prompts = const [],
  });

  factory ProviderAuthMethod.fromJson(Map<String, dynamic> json) {
    final rawPrompts = json['prompts'] as List<dynamic>?;
    return ProviderAuthMethod(
      type: json['type'] == 'oauth'
          ? ProviderAuthType.oauth
          : ProviderAuthType.api,
      label:
          (json['label'] as String?) ?? (json['name'] as String?) ?? 'Unknown',
      description: json['description'] as String?,
      url: json['url'] as String?,
      prompts:
          rawPrompts
              ?.map((p) => AuthPrompt.fromJson(p as Map<String, dynamic>))
              .toList() ??
          const [],
    );
  }

  // Backward-compatible alias
  String get name => label;

  bool get isApiKey => type == ProviderAuthType.api;
  bool get isOAuth => type == ProviderAuthType.oauth;
  bool get hasPrompts => prompts.isNotEmpty;
}

/// A dynamic form prompt for provider authentication.
/// Can be a text input or a select dropdown with options.
class AuthPrompt {
  final String type; // "text" or "select"
  final String key;
  final String message;
  final String? placeholder;
  final List<AuthPromptOption> options; // only for "select"
  final AuthPromptWhen? when;

  const AuthPrompt({
    required this.type,
    required this.key,
    required this.message,
    this.placeholder,
    this.options = const [],
    this.when,
  });

  factory AuthPrompt.fromJson(Map<String, dynamic> json) {
    final rawOptions = json['options'] as List<dynamic>?;
    final rawWhen = json['when'] as Map<String, dynamic>?;
    return AuthPrompt(
      type: json['type'] as String? ?? 'text',
      key: json['key'] as String? ?? '',
      message: json['message'] as String? ?? '',
      placeholder: json['placeholder'] as String?,
      options:
          rawOptions
              ?.map((o) => AuthPromptOption.fromJson(o as Map<String, dynamic>))
              .toList() ??
          const [],
      when: rawWhen != null ? AuthPromptWhen.fromJson(rawWhen) : null,
    );
  }

  bool get isText => type == 'text';
  bool get isSelect => type == 'select';
}

class AuthPromptOption {
  final String label;
  final String value;
  final String? hint;

  const AuthPromptOption({required this.label, required this.value, this.hint});

  factory AuthPromptOption.fromJson(Map<String, dynamic> json) {
    return AuthPromptOption(
      label: json['label'] as String? ?? '',
      value: json['value'] as String? ?? '',
      hint: json['hint'] as String?,
    );
  }
}

/// Conditional visibility: show this prompt only when another prompt's
/// value matches (eq) or doesn't match (neq) a given value.
class AuthPromptWhen {
  final String key;
  final String op; // "eq" or "neq"
  final String value;

  const AuthPromptWhen({
    required this.key,
    required this.op,
    required this.value,
  });

  factory AuthPromptWhen.fromJson(Map<String, dynamic> json) {
    return AuthPromptWhen(
      key: json['key'] as String? ?? '',
      op: json['op'] as String? ?? 'eq',
      value: json['value'] as String? ?? '',
    );
  }

  bool evaluate(Map<String, String> currentValues) {
    final current = currentValues[key] ?? '';
    return op == 'neq' ? current != value : current == value;
  }
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
