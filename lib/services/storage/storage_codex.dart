part of '../storage_service.dart';

/// Codex-specific offline cache methods.
///
/// Supplements the Codex cache already in [StorageService] (threads, models,
/// projects, thread messages) with config, experimental features, and
/// cache-freshness helpers.
extension StorageCodex on StorageService {
  // ── Keys ────────────────────────────────────────────────────────
  static const _cachedCodexConfigKey = 'broski_cached_codex_config';
  static const _cachedCodexExperimentalFeaturesKey =
      'broski_cached_codex_experimental_features';

  // ── Config ──────────────────────────────────────────────────────

  /// Cache the raw Codex config JSON returned by `config/read`.
  Future<void> cacheCodexConfig(Map<String, dynamic> config) =>
      _putObject(_cachedCodexConfigKey, config, (c) => c);

  /// Load cached Codex config, or `null` if nothing is cached.
  Future<Map<String, dynamic>?> getCachedCodexConfig() =>
      _getObject(_cachedCodexConfigKey, (j) => j);

  // ── Experimental Features ───────────────────────────────────────

  /// Cache the list of experimental feature maps from
  /// `experimentalFeature/list`.
  Future<void> cacheCodexExperimentalFeatures(
    List<Map<String, dynamic>> features,
  ) => _putList(_cachedCodexExperimentalFeaturesKey, features, (f) => f);

  /// Load cached experimental features.
  Future<List<Map<String, dynamic>>> getCachedCodexExperimentalFeatures() =>
      _getList(_cachedCodexExperimentalFeaturesKey, (j) => j);

  // ── Freshness Helpers ───────────────────────────────────────────

  /// Whether the Codex threads cache is still within the default TTL.
  bool isCodexThreadsCacheFresh() =>
      isCacheFresh(StorageService._cachedCodexThreadsKey);

  /// Whether the Codex models cache is still within the default TTL.
  bool isCodexModelsCacheFresh() =>
      isCacheFresh(StorageService._cachedCodexModelsKey);

  /// Whether the Codex config cache is still within the default TTL.
  bool isCodexConfigCacheFresh() => isCacheFresh(_cachedCodexConfigKey);
}
