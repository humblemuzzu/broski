import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import '../models/stt_settings.dart';
import '../services/storage_service.dart';
import '../services/stt_service.dart';
import 'service_providers.dart';

/// Recording state enum
enum RecordingState { idle, recording, transcribing, error }

/// State for the STT feature
class SttState {
  const SttState({
    this.settings = const SttSettings(),
    this.recordingState = RecordingState.idle,
    this.recordingDuration = Duration.zero,
    this.lastTranscription,
    this.error,
  });

  final SttSettings settings;
  final RecordingState recordingState;
  final Duration recordingDuration;
  final TranscriptionResult? lastTranscription;
  final String? error;

  bool get isRecording => recordingState == RecordingState.recording;
  bool get isTranscribing => recordingState == RecordingState.transcribing;
  bool get isConfigured => settings.isConfigured;
  bool get isEnabled => settings.enabled;

  SttState copyWith({
    SttSettings? settings,
    RecordingState? recordingState,
    Duration? recordingDuration,
    TranscriptionResult? lastTranscription,
    String? error,
    bool clearError = false,
    bool clearLastTranscription = false,
  }) {
    return SttState(
      settings: settings ?? this.settings,
      recordingState: recordingState ?? this.recordingState,
      recordingDuration: recordingDuration ?? this.recordingDuration,
      lastTranscription: clearLastTranscription
          ? null
          : (lastTranscription ?? this.lastTranscription),
      error: clearError ? null : (error ?? this.error),
    );
  }
}

/// Notifier for STT state
class SttNotifier extends StateNotifier<SttState> {
  SttNotifier(this._storage, this._sttService) : super(const SttState()) {
    _recorder = AudioRecorder();
    _load();
  }

  final StorageService _storage;
  final SttService _sttService;
  late final AudioRecorder _recorder;
  String? _currentRecordingPath;

  @override
  void dispose() {
    _recorder.dispose();
    super.dispose();
  }

  /// Load settings from storage
  Future<void> _load() async {
    final settings = await _storage.loadSttSettings();
    if (settings != null) {
      state = state.copyWith(settings: settings);
    }
  }

  /// Save settings to storage
  Future<void> _save() async {
    await _storage.saveSttSettings(state.settings);
  }

  /// Set the STT provider (Groq or OpenAI)
  Future<void> setProvider(SttProvider provider) async {
    // When switching providers, set the default model for that provider
    final defaultModel = SttModels.defaultForProvider(provider);
    state = state.copyWith(
      settings: state.settings.copyWith(
        provider: provider,
        modelId: defaultModel.id,
      ),
    );
    await _save();
  }

  /// Set the STT model
  Future<void> setModel(String modelId) async {
    state = state.copyWith(settings: state.settings.copyWith(modelId: modelId));
    await _save();
  }

  /// Set API key for a provider
  Future<void> setApiKey(SttProvider provider, String apiKey) async {
    if (provider == SttProvider.groq) {
      state = state.copyWith(
        settings: state.settings.copyWith(groqApiKey: apiKey),
      );
    } else {
      state = state.copyWith(
        settings: state.settings.copyWith(openaiApiKey: apiKey),
      );
    }
    await _save();
  }

  /// Clear API key for a provider
  Future<void> clearApiKey(SttProvider provider) async {
    if (provider == SttProvider.groq) {
      state = state.copyWith(
        settings: state.settings.copyWith(clearGroqApiKey: true),
      );
    } else {
      state = state.copyWith(
        settings: state.settings.copyWith(clearOpenaiApiKey: true),
      );
    }
    await _save();
  }

  /// Set language hint
  Future<void> setLanguageHint(String? language) async {
    state = state.copyWith(
      settings: language == null || language.isEmpty
          ? state.settings.copyWith(clearLanguageHint: true)
          : state.settings.copyWith(languageHint: language),
    );
    await _save();
  }

  /// Set prompt/context
  Future<void> setPrompt(String? prompt) async {
    state = state.copyWith(
      settings: prompt == null || prompt.isEmpty
          ? state.settings.copyWith(clearPrompt: true)
          : state.settings.copyWith(prompt: prompt),
    );
    await _save();
  }

  /// Enable/disable voice input
  Future<void> setEnabled(bool enabled) async {
    state = state.copyWith(settings: state.settings.copyWith(enabled: enabled));
    await _save();
  }

  /// Test the current API key
  Future<String?> testApiKey() async {
    final apiKey = state.settings.currentApiKey;
    if (apiKey == null || apiKey.isEmpty) {
      return 'No API key configured';
    }
    return _sttService.testApiKey(state.settings.provider, apiKey);
  }

  /// Test a specific API key without saving
  Future<String?> testSpecificApiKey(
    SttProvider provider,
    String apiKey,
  ) async {
    if (apiKey.isEmpty) {
      return 'API key is empty';
    }
    return _sttService.testApiKey(provider, apiKey);
  }

  /// Start recording audio
  Future<bool> startRecording() async {
    if (!state.isConfigured) {
      state = state.copyWith(
        error: 'Voice input not configured. Go to Settings > Voice Input.',
      );
      return false;
    }

    if (state.isRecording) return false;

    // Check microphone permission
    final hasPermission = await _recorder.hasPermission();
    if (!hasPermission) {
      state = state.copyWith(error: 'Microphone permission required');
      return false;
    }

    try {
      // Get temp directory for recording
      final tempDir = await getTemporaryDirectory();
      _currentRecordingPath =
          '${tempDir.path}/broski_${DateTime.now().millisecondsSinceEpoch}.m4a';

      // Use AAC encoder with settings optimized for iOS
      // Higher bitrate and sample rate for better quality
      await _recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.aacLc,
          bitRate: 256000, // Higher bitrate for better quality
          sampleRate: 44100, // Standard sample rate for iOS
          numChannels: 1,
        ),
        path: _currentRecordingPath!,
      );

      state = state.copyWith(
        recordingState: RecordingState.recording,
        recordingDuration: Duration.zero,
        clearError: true,
        clearLastTranscription: true,
      );

      return true;
    } catch (e) {
      state = state.copyWith(
        recordingState: RecordingState.error,
        error: 'Failed to start recording',
      );
      return false;
    }
  }

  /// Update recording duration (call this periodically while recording)
  void updateRecordingDuration(Duration duration) {
    if (state.isRecording) {
      state = state.copyWith(recordingDuration: duration);
    }
  }

  /// Stop recording and transcribe
  Future<TranscriptionResult?> stopAndTranscribe() async {
    if (!state.isRecording || _currentRecordingPath == null) {
      return null;
    }

    try {
      // Stop recording
      final path = await _recorder.stop();

      if (path == null) {
        state = state.copyWith(
          recordingState: RecordingState.error,
          error: 'Recording failed - no audio captured',
        );
        return null;
      }

      state = state.copyWith(recordingState: RecordingState.transcribing);

      // Check if file exists and has content
      final audioFile = File(path);
      if (!await audioFile.exists()) {
        state = state.copyWith(
          recordingState: RecordingState.error,
          error: 'Recording failed - file not found',
        );
        return null;
      }

      final fileSize = await audioFile.length();
      if (fileSize < 1000) {
        state = state.copyWith(
          recordingState: RecordingState.error,
          error: 'Recording too short. Speak longer.',
        );
        _cleanupFile(audioFile);
        return null;
      }

      // Transcribe the audio
      final result = await _sttService.transcribe(audioFile, state.settings);

      // Clean up
      _cleanupFile(audioFile);
      _currentRecordingPath = null;

      if (result.isSuccess) {
        state = state.copyWith(
          recordingState: RecordingState.idle,
          lastTranscription: result,
          clearError: true,
        );
      } else {
        state = state.copyWith(
          recordingState: RecordingState.error,
          lastTranscription: result,
          error: result.error,
        );
      }

      return result;
    } catch (e) {
      state = state.copyWith(
        recordingState: RecordingState.error,
        error: 'Transcription failed',
      );
      _currentRecordingPath = null;
      return null;
    }
  }

  void _cleanupFile(File file) {
    try {
      file.deleteSync();
    } catch (_) {}
  }

  /// Cancel recording without transcribing
  Future<void> cancelRecording() async {
    if (!state.isRecording) return;

    try {
      await _recorder.stop();
      if (_currentRecordingPath != null) {
        try {
          await File(_currentRecordingPath!).delete();
        } catch (_) {}
      }
    } catch (_) {}

    _currentRecordingPath = null;
    state = state.copyWith(
      recordingState: RecordingState.idle,
      recordingDuration: Duration.zero,
      clearError: true,
    );
  }

  /// Clear any error state
  void clearError() {
    state = state.copyWith(clearError: true);
  }
}

/// Provider for STT service
final sttServiceProvider = Provider<SttService>((ref) {
  return SttService();
});

/// Provider for STT state and functionality
final sttProvider = StateNotifierProvider<SttNotifier, SttState>((ref) {
  final storage = ref.watch(storageServiceProvider);
  final sttService = ref.watch(sttServiceProvider);
  return SttNotifier(storage, sttService);
});
