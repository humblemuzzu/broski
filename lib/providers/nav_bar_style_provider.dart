import 'package:broski/models/nav_bar_style.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Provider for navigation bar style preference
final navBarStyleProvider =
    StateNotifierProvider<NavBarStyleNotifier, NavBarStyle>(
      (ref) => NavBarStyleNotifier(ref.read(storageServiceProvider)),
    );

class NavBarStyleNotifier extends StateNotifier<NavBarStyle> {
  NavBarStyleNotifier(this._storage) : super(NavBarStyle.glassmorphic) {
    _load();
  }

  final StorageService _storage;
  static const _key = 'nav_bar_style';

  Future<void> _load() async {
    final value = await _storage.getString(_key);
    if (value != null) {
      final style = NavBarStyle.values.firstWhere(
        (s) => s.name == value,
        orElse: () => NavBarStyle.glassmorphic,
      );
      state = style;
    }
  }

  Future<void> setStyle(NavBarStyle style) async {
    state = style;
    await _storage.setString(_key, style.name);
  }
}
