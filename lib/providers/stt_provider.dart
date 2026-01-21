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
    print('[STT Provider] Loading settings from storage...');
    final settings = await _storage.loadSttSettings();

    if (settings != null) {
      print('[STT Provider] Settings loaded successfully');
      print('[STT Provider] Provider: ${settings.provider.displayName}');
      print('[STT Provider] Model: ${settings.modelId}');
      print(
        '[STT Provider] Groq key: ${settings.groqApiKey != null ? "yes (${settings.groqApiKey!.length} chars)" : "no"}',
      );
      print(
        '[STT Provider] OpenAI key: ${settings.openaiApiKey != null ? "yes (${settings.openaiApiKey!.length} chars)" : "no"}',
      );
      print('[STT Provider] isConfigured: ${settings.isConfigured}');

      state = state.copyWith(settings: settings);
    } else {
      print('[STT Provider] No settings found in storage, using defaults');
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

  /// Set API key for a provider (now stored in settings JSON, persists across clean builds)
  Future<void> setApiKey(SttProvider provider, String apiKey) async {
    print('[STT Provider] Setting API key for ${provider.displayName}');

    // Update state with new key
    if (provider == SttProvider.groq) {
      state = state.copyWith(
        settings: state.settings.copyWith(groqApiKey: apiKey),
      );
    } else {
      state = state.copyWith(
        settings: state.settings.copyWith(openaiApiKey: apiKey),
      );
    }

    // Save to persistent storage (settings JSON includes API keys now)
    await _save();
    print('[STT Provider] API key saved, isConfigured: ${state.isConfigured}');
  }

  /// Clear API key for a provider
  Future<void> clearApiKey(SttProvider provider) async {
    print('[STT Provider] Clearing API key for ${provider.displayName}');

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
    print('[STT Provider] startRecording called');
    print('[STT Provider] isConfigured: ${state.isConfigured}');
    print(
      '[STT Provider] currentApiKey present: ${state.settings.currentApiKey != null}',
    );

    if (!state.isConfigured) {
      print('[STT Provider] ERROR: Not configured');
      state = state.copyWith(
        error: 'Voice input not configured. Go to Settings > Voice Input.',
      );
      return false;
    }

    if (state.isRecording) {
      print('[STT Provider] Already recording, ignoring');
      return false;
    }

    // Check microphone permission
    print('[STT Provider] Checking microphone permission...');
    final hasPermission = await _recorder.hasPermission();
    print('[STT Provider] Has permission: $hasPermission');

    if (!hasPermission) {
      state = state.copyWith(error: 'Microphone permission required');
      return false;
    }

    try {
      // Get temp directory for recording
      final tempDir = await getTemporaryDirectory();
      _currentRecordingPath =
          '${tempDir.path}/broski_recording_${DateTime.now().millisecondsSinceEpoch}.m4a';
      print('[STT Provider] Recording path: $_currentRecordingPath');

      // Start recording with m4a format (good compression, widely supported)
      print('[STT Provider] Starting recorder...');
      await _recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.aacLc,
          bitRate: 128000,
          sampleRate: 16000, // 16kHz is optimal for speech
          numChannels: 1, // Mono
        ),
        path: _currentRecordingPath!,
      );
      print('[STT Provider] Recorder started successfully');

      state = state.copyWith(
        recordingState: RecordingState.recording,
        recordingDuration: Duration.zero,
        clearError: true,
        clearLastTranscription: true,
      );

      return true;
    } catch (e, stackTrace) {
      print('[STT Provider] ERROR starting recording: $e');
      print('[STT Provider] Stack trace: $stackTrace');
      state = state.copyWith(
        recordingState: RecordingState.error,
        error: 'Failed to start recording: $e',
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
    print('[STT Provider] stopAndTranscribe called');
    print('[STT Provider] isRecording: ${state.isRecording}');
    print('[STT Provider] currentRecordingPath: $_currentRecordingPath');

    if (!state.isRecording || _currentRecordingPath == null) {
      print('[STT Provider] ERROR: Not recording or no path');
      return null;
    }

    try {
      // Stop recording
      print('[STT Provider] Stopping recorder...');
      final path = await _recorder.stop();
      print('[STT Provider] Recorder stopped, path: $path');

      if (path == null) {
        print('[STT Provider] ERROR: No path returned from recorder');
        state = state.copyWith(
          recordingState: RecordingState.error,
          error: 'Recording failed - no audio captured',
        );
        return null;
      }

      state = state.copyWith(recordingState: RecordingState.transcribing);

      // Check if file exists and has content
      final audioFile = File(path);
      final exists = await audioFile.exists();
      final fileSize = exists ? await audioFile.length() : 0;
      print('[STT Provider] Audio file exists: $exists, size: $fileSize bytes');

      if (!exists || fileSize < 100) {
        print('[STT Provider] ERROR: Audio file is empty or missing');
        state = state.copyWith(
          recordingState: RecordingState.error,
          error: 'Recording failed - audio file is empty',
        );
        return null;
      }

      // Transcribe the audio
      print('[STT Provider] Calling sttService.transcribe...');
      final result = await _sttService.transcribe(audioFile, state.settings);
      print(
        '[STT Provider] Transcription result: success=${result.isSuccess}, text="${result.text}", error="${result.error}"',
      );

      // Clean up the temp file
      try {
        await audioFile.delete();
        print('[STT Provider] Temp file deleted');
      } catch (e) {
        print('[STT Provider] Failed to delete temp file: $e');
      }
      _currentRecordingPath = null;

      if (result.isSuccess) {
        print('[STT Provider] Transcription SUCCESS!');
        state = state.copyWith(
          recordingState: RecordingState.idle,
          lastTranscription: result,
          clearError: true,
        );
      } else {
        print('[STT Provider] Transcription FAILED: ${result.error}');
        state = state.copyWith(
          recordingState: RecordingState.error,
          lastTranscription: result,
          error: result.error,
        );
      }

      return result;
    } catch (e, stackTrace) {
      print('[STT Provider] EXCEPTION in stopAndTranscribe: $e');
      print('[STT Provider] Stack trace: $stackTrace');
      state = state.copyWith(
        recordingState: RecordingState.error,
        error: 'Transcription failed: $e',
      );
      _currentRecordingPath = null;
      return null;
    }
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
