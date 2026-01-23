import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/card_style.dart';
import 'service_providers.dart';

/// Provider for managing tool card style settings.
class CardStyleNotifier extends StateNotifier<CardStyleSettings> {
  CardStyleNotifier(this._ref) : super(CardStyleSettings.defaultSettings) {
    _load();
  }

  final Ref _ref;

  Future<void> _load() async {
    final storage = _ref.read(storageServiceProvider);
    final headerStyle = await storage.getCardHeaderStyle();
    final borderVisibility = await storage.getCardBorderVisibility();

    state = CardStyleSettings(
      headerStyle: CardHeaderStyle.values.firstWhere(
        (s) => s.name == headerStyle,
        orElse: () => CardHeaderStyle.solid,
      ),
      borderVisibility: CardBorderVisibility.values.firstWhere(
        (v) => v.name == borderVisibility,
        orElse: () => CardBorderVisibility.visible,
      ),
    );
  }

  Future<void> setHeaderStyle(CardHeaderStyle style) async {
    state = state.copyWith(headerStyle: style);
    final storage = _ref.read(storageServiceProvider);
    await storage.saveCardHeaderStyle(style.name);
  }

  Future<void> setBorderVisibility(CardBorderVisibility visibility) async {
    state = state.copyWith(borderVisibility: visibility);
    final storage = _ref.read(storageServiceProvider);
    await storage.saveCardBorderVisibility(visibility.name);
  }
}

final cardStyleProvider =
    StateNotifierProvider<CardStyleNotifier, CardStyleSettings>((ref) {
      return CardStyleNotifier(ref);
    });
