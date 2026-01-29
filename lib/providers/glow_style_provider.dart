import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/glow_style.dart';
import 'service_providers.dart';

/// Provider for managing the input bar glow style selection.
class GlowStyleNotifier extends StateNotifier<GlowStyle> {
  GlowStyleNotifier(this._ref) : super(GlowStyle.fullBorder) {
    _load();
  }

  final Ref _ref;

  Future<void> _load() async {
    final storage = _ref.read(storageServiceProvider);
    final value = await storage.getGlowStyle();
    state = GlowStyle.fromString(value);
  }

  Future<void> setStyle(GlowStyle style) async {
    state = style;
    final storage = _ref.read(storageServiceProvider);
    await storage.saveGlowStyle(style.name);
  }
}

final glowStyleProvider = StateNotifierProvider<GlowStyleNotifier, GlowStyle>((
  ref,
) {
  return GlowStyleNotifier(ref);
});
