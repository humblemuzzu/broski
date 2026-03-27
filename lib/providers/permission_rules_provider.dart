import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/permission_rule.dart';
import '../services/storage_service.dart';

class PermissionRulesState {
  const PermissionRulesState({
    this.preset = PermissionPreset.askEverything,
    this.customRules = const [],
    this.loaded = false,
  });

  final PermissionPreset preset;
  final PermissionRuleset customRules;
  final bool loaded;

  PermissionRuleset get effectiveRuleset =>
      preset == PermissionPreset.custom ? customRules : preset.toRuleset();

  PermissionRulesState copyWith({
    PermissionPreset? preset,
    PermissionRuleset? customRules,
    bool? loaded,
  }) {
    return PermissionRulesState(
      preset: preset ?? this.preset,
      customRules: customRules ?? this.customRules,
      loaded: loaded ?? this.loaded,
    );
  }
}

class PermissionRulesNotifier extends StateNotifier<PermissionRulesState> {
  PermissionRulesNotifier(this._storage) : super(const PermissionRulesState()) {
    _load();
  }

  final StorageService _storage;

  Future<void> _load() async {
    final saved = await _storage.loadPermissionRules();
    if (saved == null) {
      state = state.copyWith(loaded: true);
      return;
    }
    state = state.copyWith(
      preset: saved.preset,
      customRules: saved.customRules,
      loaded: true,
    );
  }

  Future<void> setPreset(PermissionPreset preset) async {
    state = state.copyWith(preset: preset);
    await _storage.savePermissionRules(
      preset: state.preset,
      customRules: state.customRules,
    );
  }

  Future<void> setCustomRules(PermissionRuleset rules) async {
    state = state.copyWith(preset: PermissionPreset.custom, customRules: rules);
    await _storage.savePermissionRules(
      preset: state.preset,
      customRules: state.customRules,
    );
  }
}

final permissionRulesProvider =
    StateNotifierProvider<PermissionRulesNotifier, PermissionRulesState>((ref) {
      return PermissionRulesNotifier(StorageService());
    });
