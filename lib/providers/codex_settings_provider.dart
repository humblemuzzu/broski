import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/codex.dart';
import '../services/storage_service.dart';
import 'service_providers.dart';

class CodexSettingsNotifier extends StateNotifier<CodexSettings> {
  CodexSettingsNotifier(this._storage) : super(const CodexSettings()) {
    _load();
  }

  final StorageService _storage;

  Future<void> _load() async {
    final loaded = await _storage.loadCodexSettings();
    if (loaded != null) state = loaded;
  }

  Future<void> _save() async {
    await _storage.saveCodexSettings(state);
  }

  Future<void> setApprovalPolicy(CodexApprovalPolicy policy) async {
    state = state.copyWith(approvalPolicy: policy);
    await _save();
  }

  Future<void> setSandboxMode(CodexSandboxMode mode) async {
    state = state.copyWith(sandboxMode: mode);
    await _save();
  }

  Future<void> setNetworkAccessEnabled(bool enabled) async {
    state = state.copyWith(networkAccessEnabled: enabled);
    await _save();
  }

  Future<void> setReasoningEffort(CodexReasoningEffort effort) async {
    state = state.copyWith(reasoningEffort: effort);
    await _save();
  }

  Future<void> setReasoningSummary(CodexReasoningSummary summary) async {
    state = state.copyWith(reasoningSummary: summary);
    await _save();
  }

  Future<void> setWebSearchEnabled(bool enabled) async {
    state = state.copyWith(webSearchEnabled: enabled);
    await _save();
  }

  Future<void> setSkillsEnabled(bool enabled) async {
    state = state.copyWith(skillsEnabled: enabled);
    await _save();
  }

  Future<void> setCollaborationMode(CodexCollaborationMode mode) async {
    state = state.copyWith(collaborationMode: mode);
    await _save();
  }

  void cycleCollaborationMode() {
    final modes = CodexCollaborationMode.values;
    final currentIndex = modes.indexOf(state.collaborationMode);
    final nextIndex = (currentIndex + 1) % modes.length;
    setCollaborationMode(modes[nextIndex]);
  }
}

final codexSettingsProvider =
    StateNotifierProvider<CodexSettingsNotifier, CodexSettings>((ref) {
      final storage = ref.watch(storageServiceProvider);
      return CodexSettingsNotifier(storage);
    });
