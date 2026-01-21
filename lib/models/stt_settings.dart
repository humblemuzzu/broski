// Speech-to-Text (STT) settings for BYOK voice input.
//
// Supports Groq and OpenAI providers with their respective models.
// Both use OpenAI-compatible API format for easy integration.

/// STT provider enum
enum SttProvider {
  groq('groq', 'Groq', 'https://api.groq.com/openai'),
  openai('openai', 'OpenAI', 'https://api.openai.com');

  const SttProvider(this.id, this.displayName, this.baseUrl);

  final String id;
  final String displayName;
  final String baseUrl;

  static SttProvider fromId(String id) {
    return SttProvider.values.firstWhere(
      (p) => p.id == id,
      orElse: () => SttProvider.groq,
    );
  }
}

/// STT model configuration
class SttModel {
  const SttModel({
    required this.id,
    required this.displayName,
    required this.provider,
    this.description,
    this.isDefault = false,
  });

  final String id;
  final String displayName;
  final SttProvider provider;
  final String? description;
  final bool isDefault;

  Map<String, dynamic> toJson() => {
    'id': id,
    'displayName': displayName,
    'provider': provider.id,
    'description': description,
    'isDefault': isDefault,
  };

  factory SttModel.fromJson(Map<String, dynamic> json) {
    return SttModel(
      id: json['id'] as String? ?? '',
      displayName: json['displayName'] as String? ?? '',
      provider: SttProvider.fromId(json['provider'] as String? ?? 'groq'),
      description: json['description'] as String?,
      isDefault: json['isDefault'] as bool? ?? false,
    );
  }
}

/// Available STT models by provider
class SttModels {
  SttModels._();

  // Groq models (OpenAI-compatible, cheapest & fastest)
  static const groqWhisperLargeV3Turbo = SttModel(
    id: 'whisper-large-v3-turbo',
    displayName: 'Whisper Large V3 Turbo',
    provider: SttProvider.groq,
    description: 'Best balance of speed and accuracy',
    isDefault: true,
  );

  static const groqWhisperLargeV3 = SttModel(
    id: 'whisper-large-v3',
    displayName: 'Whisper Large V3',
    provider: SttProvider.groq,
    description: 'Highest accuracy',
  );

  // OpenAI models
  static const openaiWhisper1 = SttModel(
    id: 'whisper-1',
    displayName: 'Whisper 1',
    provider: SttProvider.openai,
    description: 'Classic baseline model',
    isDefault: true,
  );

  static const openaiGpt4oTranscribe = SttModel(
    id: 'gpt-4o-transcribe',
    displayName: 'GPT-4o Transcribe',
    provider: SttProvider.openai,
    description: 'Best accuracy',
  );

  static const openaiGpt4oMiniTranscribe = SttModel(
    id: 'gpt-4o-mini-transcribe',
    displayName: 'GPT-4o Mini Transcribe',
    provider: SttProvider.openai,
    description: 'Cheaper, good accuracy',
  );

  /// All Groq models
  static const List<SttModel> groqModels = [
    groqWhisperLargeV3Turbo,
    groqWhisperLargeV3,
  ];

  /// All OpenAI models
  static const List<SttModel> openaiModels = [
    openaiWhisper1,
    openaiGpt4oTranscribe,
    openaiGpt4oMiniTranscribe,
  ];

  /// Get models for a provider
  static List<SttModel> forProvider(SttProvider provider) {
    switch (provider) {
      case SttProvider.groq:
        return groqModels;
      case SttProvider.openai:
        return openaiModels;
    }
  }

  /// Get default model for a provider
  static SttModel defaultForProvider(SttProvider provider) {
    final models = forProvider(provider);
    return models.firstWhere((m) => m.isDefault, orElse: () => models.first);
  }

  /// Find model by ID
  static SttModel? findById(String id) {
    final all = [...groqModels, ...openaiModels];
    try {
      return all.firstWhere((m) => m.id == id);
    } catch (_) {
      return null;
    }
  }
}

/// User's STT configuration
class SttSettings {
  const SttSettings({
    this.provider = SttProvider.groq,
    this.modelId = 'whisper-large-v3-turbo',
    this.groqApiKey,
    this.openaiApiKey,
    this.languageHint,
    this.prompt,
    this.enabled = true,
  });

  /// Selected provider
  final SttProvider provider;

  /// Selected model ID
  final String modelId;

  /// Groq API key (stored securely)
  final String? groqApiKey;

  /// OpenAI API key (stored securely)
  final String? openaiApiKey;

  /// Optional language hint (ISO-639-1, e.g., 'en', 'es')
  final String? languageHint;

  /// Optional prompt for context/spelling hints
  final String? prompt;

  /// Whether voice input is enabled
  final bool enabled;

  /// Get the current API key for selected provider
  String? get currentApiKey {
    switch (provider) {
      case SttProvider.groq:
        return groqApiKey;
      case SttProvider.openai:
        return openaiApiKey;
    }
  }

  /// Check if the current provider is configured
  bool get isConfigured => currentApiKey != null && currentApiKey!.isNotEmpty;

  /// Get the selected model
  SttModel get model =>
      SttModels.findById(modelId) ?? SttModels.defaultForProvider(provider);

  SttSettings copyWith({
    SttProvider? provider,
    String? modelId,
    String? groqApiKey,
    String? openaiApiKey,
    String? languageHint,
    String? prompt,
    bool? enabled,
    bool clearGroqApiKey = false,
    bool clearOpenaiApiKey = false,
    bool clearLanguageHint = false,
    bool clearPrompt = false,
  }) {
    return SttSettings(
      provider: provider ?? this.provider,
      modelId: modelId ?? this.modelId,
      groqApiKey: clearGroqApiKey ? null : (groqApiKey ?? this.groqApiKey),
      openaiApiKey: clearOpenaiApiKey
          ? null
          : (openaiApiKey ?? this.openaiApiKey),
      languageHint: clearLanguageHint
          ? null
          : (languageHint ?? this.languageHint),
      prompt: clearPrompt ? null : (prompt ?? this.prompt),
      enabled: enabled ?? this.enabled,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'provider': provider.id,
      'modelId': modelId,
      'languageHint': languageHint,
      'prompt': prompt,
      'enabled': enabled,
      // API keys stored here now (persists across clean builds)
      'groqApiKey': groqApiKey,
      'openaiApiKey': openaiApiKey,
    };
  }

  factory SttSettings.fromJson(Map<String, dynamic> json) {
    return SttSettings(
      provider: SttProvider.fromId(json['provider'] as String? ?? 'groq'),
      modelId: json['modelId'] as String? ?? 'whisper-large-v3-turbo',
      languageHint: json['languageHint'] as String?,
      prompt: json['prompt'] as String?,
      enabled: json['enabled'] as bool? ?? true,
      // Load API keys from settings JSON
      groqApiKey: json['groqApiKey'] as String?,
      openaiApiKey: json['openaiApiKey'] as String?,
    );
  }

  @override
  bool operator ==(Object other) {
    return other is SttSettings &&
        other.provider == provider &&
        other.modelId == modelId &&
        other.groqApiKey == groqApiKey &&
        other.openaiApiKey == openaiApiKey &&
        other.languageHint == languageHint &&
        other.prompt == prompt &&
        other.enabled == enabled;
  }

  @override
  int get hashCode => Object.hash(
    provider,
    modelId,
    groqApiKey,
    openaiApiKey,
    languageHint,
    prompt,
    enabled,
  );
}

/// Result of a transcription request
class TranscriptionResult {
  const TranscriptionResult({
    required this.text,
    this.durationSeconds,
    this.language,
    this.error,
  });

  /// Transcribed text
  final String text;

  /// Audio duration in seconds (if available)
  final double? durationSeconds;

  /// Detected language (if available)
  final String? language;

  /// Error message (if failed)
  final String? error;

  bool get isSuccess => error == null;
  bool get isError => error != null;

  factory TranscriptionResult.success(
    String text, {
    double? durationSeconds,
    String? language,
  }) {
    return TranscriptionResult(
      text: text,
      durationSeconds: durationSeconds,
      language: language,
    );
  }

  factory TranscriptionResult.failure(String error) {
    return TranscriptionResult(text: '', error: error);
  }
}
