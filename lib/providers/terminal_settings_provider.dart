import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/terminal_settings.dart';
import '../services/storage_service.dart';
import 'service_providers.dart';

class TerminalSettingsNotifier extends StateNotifier<TerminalSettings> {
  TerminalSettingsNotifier(this._storage) : super(const TerminalSettings()) {
    _load();
  }

  final StorageService _storage;

  Future<void> _load() async {
    final loaded = await _storage.loadTerminalSettings();
    if (loaded != null) state = loaded;
  }

  Future<void> _save() async {
    await _storage.saveTerminalSettings(state);
  }

  Future<void> setFontSize(double fontSize) async {
    state = state.copyWith(fontSize: fontSize);
    await _save();
  }

  Future<void> setMaxLines(int maxLines) async {
    state = state.copyWith(maxLines: maxLines);
    await _save();
  }

  Future<void> setShowQuickToolbar(bool value) async {
    state = state.copyWith(showQuickToolbar: value);
    await _save();
  }

  Future<void> setShowSelectionToolbar(bool value) async {
    state = state.copyWith(showSelectionToolbar: value);
    await _save();
  }

  Future<void> setHardwareKeyboardOnly(bool value) async {
    state = state.copyWith(hardwareKeyboardOnly: value);
    await _save();
  }

  Future<void> setDeleteDetection(bool value) async {
    state = state.copyWith(deleteDetection: value);
    await _save();
  }

  Future<void> setInputBatchMs(int value) async {
    state = state.copyWith(inputBatchMs: value);
    await _save();
  }

  Future<void> setOutputBatchMs(int value) async {
    state = state.copyWith(outputBatchMs: value);
    await _save();
  }

  Future<void> setEnableBinaryDetection(bool value) async {
    state = state.copyWith(enableBinaryDetection: value);
    await _save();
  }

  Future<void> setNormalizeSmartQuotes(bool value) async {
    state = state.copyWith(normalizeSmartQuotes: value);
    await _save();
  }
}

final terminalSettingsProvider =
    StateNotifierProvider<TerminalSettingsNotifier, TerminalSettings>((ref) {
      final storage = ref.watch(storageServiceProvider);
      return TerminalSettingsNotifier(storage);
    });
