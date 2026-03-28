import 'package:broski/models/prompt_accent_color.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Provider for managing the prompt bar accent color selection.
class PromptAccentNotifier extends StateNotifier<PromptAccentColor> {
  PromptAccentNotifier(this._ref) : super(PromptAccentColor.themePrimary) {
    _load();
  }

  final Ref _ref;

  Future<void> _load() async {
    final storage = _ref.read(storageServiceProvider);
    final value = await storage.getPromptAccentColor();
    state = PromptAccentColor.fromString(value);
  }

  Future<void> setColor(PromptAccentColor color) async {
    state = color;
    final storage = _ref.read(storageServiceProvider);
    await storage.savePromptAccentColor(color.name);
  }
}

final promptAccentProvider =
    StateNotifierProvider<PromptAccentNotifier, PromptAccentColor>((ref) {
      return PromptAccentNotifier(ref);
    });
