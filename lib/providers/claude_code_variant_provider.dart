import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/storage_service.dart';
import 'service_providers.dart';

/// Available thinking level variants for Claude Code.
/// These map to maxThinkingTokens values in the bridge.
/// Unlike OpenCode which has dynamic discovery, Claude Code uses static presets.
const List<String> claudeCodeVariants = [
  'low', // Quick responses (4096 tokens)
  'medium', // Balanced (16384 tokens)
  'high', // Deep reasoning (65536 tokens)
  'max', // Model maximum
];

/// State for managing Claude Code thinking level variant.
class ClaudeCodeVariantState {
  const ClaudeCodeVariantState({this.selectedVariant});

  /// Currently selected variant. null means use default (no thinking override).
  final String? selectedVariant;

  ClaudeCodeVariantState copyWith({
    String? selectedVariant,
    bool clearVariant = false,
  }) {
    return ClaudeCodeVariantState(
      selectedVariant: clearVariant
          ? null
          : (selectedVariant ?? this.selectedVariant),
    );
  }

  /// Get display name for current variant (or "Default" if none).
  String get displayName {
    if (selectedVariant == null || selectedVariant!.isEmpty) return 'Default';
    // Capitalize first letter
    return selectedVariant![0].toUpperCase() + selectedVariant!.substring(1);
  }

  /// Check if a non-default variant is selected.
  bool get hasVariant => selectedVariant != null && selectedVariant!.isNotEmpty;

  Map<String, dynamic> toJson() {
    return {'selectedVariant': selectedVariant};
  }

  factory ClaudeCodeVariantState.fromJson(Map<String, dynamic> json) {
    return ClaudeCodeVariantState(
      selectedVariant: json['selectedVariant'] as String?,
    );
  }
}

class ClaudeCodeVariantNotifier extends StateNotifier<ClaudeCodeVariantState> {
  ClaudeCodeVariantNotifier(this._storage)
    : super(const ClaudeCodeVariantState()) {
    _load();
  }

  final StorageService _storage;

  Future<void> _load() async {
    final data = await _storage.loadClaudeCodeVariant();
    if (data != null) {
      state = ClaudeCodeVariantState.fromJson(data);
    }
  }

  Future<void> _save() async {
    await _storage.saveClaudeCodeVariant(state.toJson());
  }

  /// Set the thinking level variant.
  Future<void> setVariant(String? variant) async {
    if (variant == null ||
        variant.isEmpty ||
        variant.toLowerCase() == 'default') {
      state = state.copyWith(clearVariant: true);
    } else {
      state = state.copyWith(selectedVariant: variant.toLowerCase());
    }
    await _save();
  }

  /// Cycle to next variant.
  /// Order: Default -> low -> medium -> high -> max -> Default
  Future<void> cycleVariant() async {
    final current = state.selectedVariant;
    String? nextVariant;

    if (current == null || current.isEmpty) {
      // Currently on default, go to first variant
      nextVariant = claudeCodeVariants.first;
    } else {
      final index = claudeCodeVariants.indexOf(current);
      if (index == -1 || index >= claudeCodeVariants.length - 1) {
        // Not found or at last variant, go back to default
        nextVariant = null;
      } else {
        // Go to next variant
        nextVariant = claudeCodeVariants[index + 1];
      }
    }

    await setVariant(nextVariant);
  }

  /// Clear variant selection (use default).
  Future<void> clearVariant() async {
    await setVariant(null);
  }
}

final claudeCodeVariantProvider =
    StateNotifierProvider<ClaudeCodeVariantNotifier, ClaudeCodeVariantState>((
      ref,
    ) {
      final storage = ref.watch(storageServiceProvider);
      return ClaudeCodeVariantNotifier(storage);
    });
