import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Represents available model variants (thinking levels) for an OpenCode model.
/// Variants define different thinking effort configurations like "high", "max", etc.
class ModelVariants {
  const ModelVariants({required this.modelKey, this.variants = const []});

  /// Model key in format "providerID/modelID"
  final String modelKey;

  /// Available variant names (e.g., ["high", "max"] for Anthropic, ["low", "medium", "high", "xhigh"] for OpenAI)
  final List<String> variants;

  bool get hasVariants => variants.isNotEmpty;
}

/// State for managing OpenCode model variants (thinking levels).
class OpenCodeVariantState {
  const OpenCodeVariantState({
    this.variantByModel = const {},
    this.availableVariantsByModel = const {},
  });

  /// Currently selected variant per model key (providerID/modelID).
  /// null means use default (no thinking/reasoning effort override).
  final Map<String, String?> variantByModel;

  /// Available variants per model key, populated from provider data.
  final Map<String, List<String>> availableVariantsByModel;

  OpenCodeVariantState copyWith({
    Map<String, String?>? variantByModel,
    Map<String, List<String>>? availableVariantsByModel,
  }) {
    return OpenCodeVariantState(
      variantByModel: variantByModel ?? this.variantByModel,
      availableVariantsByModel:
          availableVariantsByModel ?? this.availableVariantsByModel,
    );
  }

  /// Get current variant for a model.
  String? getVariant(SelectedModel? model) {
    if (model == null) return null;
    final key = '${model.providerID}/${model.modelID}';
    return variantByModel[key];
  }

  /// Get available variants for a model.
  List<String> getAvailableVariants(SelectedModel? model) {
    if (model == null) return [];
    final key = '${model.providerID}/${model.modelID}';
    return availableVariantsByModel[key] ?? [];
  }

  /// Check if model has variants available.
  bool hasVariants(SelectedModel? model) {
    return getAvailableVariants(model).isNotEmpty;
  }

  /// Get display name for current variant (or "Default" if none).
  String getVariantDisplayName(SelectedModel? model) {
    final variant = getVariant(model);
    if (variant == null || variant.isEmpty) return 'Default';
    // Capitalize first letter
    return variant[0].toUpperCase() + variant.substring(1);
  }

  Map<String, dynamic> toJson() {
    return {'variantByModel': variantByModel};
  }

  factory OpenCodeVariantState.fromJson(Map<String, dynamic> json) {
    final variantByModel = <String, String?>{};
    final rawMap = json['variantByModel'];
    if (rawMap is Map) {
      for (final entry in rawMap.entries) {
        if (entry.key is String) {
          variantByModel[entry.key as String] = entry.value as String?;
        }
      }
    }
    return OpenCodeVariantState(variantByModel: variantByModel);
  }
}

class OpenCodeVariantNotifier extends StateNotifier<OpenCodeVariantState> {
  OpenCodeVariantNotifier(this._storage) : super(const OpenCodeVariantState()) {
    _load();
  }

  final StorageService _storage;

  Future<void> _load() async {
    final data = await _storage.loadOpenCodeVariants();
    if (data != null) {
      state = OpenCodeVariantState.fromJson(data);
    }
  }

  Future<void> _save() async {
    await _storage.saveOpenCodeVariants(state.toJson());
  }

  /// Set variant for a specific model.
  Future<void> setVariant(SelectedModel model, String? variant) async {
    final key = '${model.providerID}/${model.modelID}';
    final newMap = Map<String, String?>.from(state.variantByModel);
    if (variant == null || variant.isEmpty) {
      newMap.remove(key);
    } else {
      newMap[key] = variant;
    }
    state = state.copyWith(variantByModel: newMap);
    await _save();
  }

  /// Cycle to next variant for a model.
  /// Order: Default -> variant1 -> variant2 -> ... -> Default
  Future<void> cycleVariant(SelectedModel model) async {
    final variants = state.getAvailableVariants(model);
    if (variants.isEmpty) return;

    final currentVariant = state.getVariant(model);
    String? nextVariant;

    if (currentVariant == null) {
      // Currently on default, go to first variant
      nextVariant = variants.first;
    } else {
      final index = variants.indexOf(currentVariant);
      if (index == -1 || index >= variants.length - 1) {
        // Not found or at last variant, go back to default
        nextVariant = null;
      } else {
        // Go to next variant
        nextVariant = variants[index + 1];
      }
    }

    await setVariant(model, nextVariant);
  }

  /// Update available variants for models from provider data.
  /// Called when provider list is refreshed.
  void updateAvailableVariants(Map<String, dynamic> providersData) {
    final newAvailable = <String, List<String>>{};

    final providers = providersData['providers'] as List<dynamic>? ?? [];
    for (final provider in providers) {
      if (provider is! Map<String, dynamic>) continue;
      final providerId = provider['id'] as String? ?? '';
      final models = provider['models'] as Map<String, dynamic>? ?? {};

      for (final entry in models.entries) {
        final modelId = entry.key;
        final modelData = entry.value;
        if (modelData is! Map<String, dynamic>) continue;

        final variants = modelData['variants'];
        if (variants is Map<String, dynamic> && variants.isNotEmpty) {
          final key = '$providerId/$modelId';
          newAvailable[key] = variants.keys.toList();
        }
      }
    }

    state = state.copyWith(availableVariantsByModel: newAvailable);
  }

  /// Clear variant selection for a model.
  Future<void> clearVariant(SelectedModel model) async {
    await setVariant(model, null);
  }

  /// Clear all variant selections.
  Future<void> clearAll() async {
    state = state.copyWith(variantByModel: {});
    await _save();
  }
}

final openCodeVariantProvider =
    StateNotifierProvider<OpenCodeVariantNotifier, OpenCodeVariantState>((ref) {
      final storage = ref.watch(storageServiceProvider);
      return OpenCodeVariantNotifier(storage);
    });
