import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/codex_collab_mode.dart';
import 'service_providers.dart';

/// Hardcoded fallback presets so the UI always has something to show,
/// even if the bridge/Codex isn't running or the request fails.
const _fallbackPresets = [
  CodexCollabModePreset(name: 'Default', mode: 'default'),
  CodexCollabModePreset(name: 'Plan', mode: 'plan'),
];

/// Cached collaboration-mode presets from Codex `collaborationMode/list`.
///
/// • First call fetches from bridge, caches in memory for [_cacheTtl].
/// • Subsequent calls within the TTL window return the cached list instantly.
/// • On error falls back to [_fallbackPresets] so the UI never shows empty.
class CodexCollabModesNotifier
    extends StateNotifier<AsyncValue<List<CodexCollabModePreset>>> {
  CodexCollabModesNotifier(this._ref) : super(const AsyncValue.loading()) {
    load();
  }

  final Ref _ref;

  /// Cache lifetime — 5 minutes.
  static const _cacheTtl = Duration(minutes: 5);

  List<CodexCollabModePreset>? _cached;
  DateTime? _cachedAt;

  bool get _cacheValid =>
      _cached != null &&
      _cachedAt != null &&
      DateTime.now().difference(_cachedAt!) < _cacheTtl;

  Future<void> load() async {
    if (_cacheValid) {
      state = AsyncValue.data(_cached!);
      return;
    }
    // Don't show loading spinner if we already have cached data — keeps UI snappy.
    if (_cached == null) {
      state = const AsyncValue.loading();
    }
    try {
      final bridge = _ref.read(bridgeServiceProvider);
      final raw = await bridge.cxListCollaborationModes();
      final presets =
          raw.map((j) => CodexCollabModePreset.fromJson(j)).toList();

      if (presets.isEmpty) {
        _cached = _fallbackPresets;
      } else {
        _cached = presets;
      }
      _cachedAt = DateTime.now();
      state = AsyncValue.data(_cached!);
    } catch (e, st) {
      // On error, use fallback if no prior cache
      if (_cached != null) {
        state = AsyncValue.data(_cached!);
      } else {
        _cached = _fallbackPresets;
        _cachedAt = DateTime.now();
        state = AsyncValue.data(_cached!);
      }
      // Still log the error for debugging
      assert(() {
        // ignore: avoid_print
        print('[CodexCollabModes] fetch failed: $e\n$st');
        return true;
      }());
    }
  }

  /// Force refresh from server (ignores cache TTL).
  Future<void> refresh() async {
    _cached = null;
    _cachedAt = null;
    await load();
  }

  /// Find the preset matching a wire mode string (e.g. `"plan"`).
  CodexCollabModePreset? findByMode(String wireMode) {
    final list = _cached ?? _fallbackPresets;
    for (final p in list) {
      if (p.wireMode == wireMode) return p;
    }
    return null;
  }
}

final codexCollabModesProvider = StateNotifierProvider<
    CodexCollabModesNotifier, AsyncValue<List<CodexCollabModePreset>>>((ref) {
  return CodexCollabModesNotifier(ref);
});
