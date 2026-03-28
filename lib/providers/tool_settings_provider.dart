import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// State for tool settings - tracks which tools are disabled
class ToolSettingsState {
  final Set<String> disabledTools;
  final bool isLoaded;

  const ToolSettingsState({
    this.disabledTools = const {},
    this.isLoaded = false,
  });

  ToolSettingsState copyWith({Set<String>? disabledTools, bool? isLoaded}) {
    return ToolSettingsState(
      disabledTools: disabledTools ?? this.disabledTools,
      isLoaded: isLoaded ?? this.isLoaded,
    );
  }

  bool isToolEnabled(String toolId) {
    return !disabledTools.contains(toolId.toLowerCase());
  }
}

/// Provider for managing tool enable/disable settings
class ToolSettingsNotifier extends StateNotifier<ToolSettingsState> {
  final StorageService _storage;

  ToolSettingsNotifier(this._storage) : super(const ToolSettingsState()) {
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    try {
      final disabledTools = await _storage.getDisabledTools();
      state = state.copyWith(disabledTools: disabledTools, isLoaded: true);
    } catch (_) {
      state = state.copyWith(isLoaded: true);
    }
  }

  Future<void> _saveSettings() async {
    await _storage.saveDisabledTools(state.disabledTools);
  }

  /// Toggle a tool's enabled state
  Future<void> toggleTool(String toolId) async {
    final id = toolId.toLowerCase();
    final newDisabled = Set<String>.from(state.disabledTools);

    if (newDisabled.contains(id)) {
      newDisabled.remove(id);
    } else {
      newDisabled.add(id);
    }

    state = state.copyWith(disabledTools: newDisabled);
    await _saveSettings();
  }

  /// Enable a specific tool
  Future<void> enableTool(String toolId) async {
    final id = toolId.toLowerCase();
    if (state.disabledTools.contains(id)) {
      final newDisabled = Set<String>.from(state.disabledTools)..remove(id);
      state = state.copyWith(disabledTools: newDisabled);
      await _saveSettings();
    }
  }

  /// Disable a specific tool
  Future<void> disableTool(String toolId) async {
    final id = toolId.toLowerCase();
    if (!state.disabledTools.contains(id)) {
      final newDisabled = Set<String>.from(state.disabledTools)..add(id);
      state = state.copyWith(disabledTools: newDisabled);
      await _saveSettings();
    }
  }

  /// Enable all tools
  Future<void> enableAllTools() async {
    state = state.copyWith(disabledTools: {});
    await _saveSettings();
  }

  /// Get list of enabled tool IDs from a full list
  List<String> getEnabledToolIds(List<String> allToolIds) {
    return allToolIds
        .where((id) => !state.disabledTools.contains(id.toLowerCase()))
        .toList();
  }
}

/// Provider for tool settings
final toolSettingsProvider =
    StateNotifierProvider<ToolSettingsNotifier, ToolSettingsState>((ref) {
      final storage = ref.watch(storageServiceProvider);
      return ToolSettingsNotifier(storage);
    });
